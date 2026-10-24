import * as core from '@actions/core'
import * as fs from 'fs'
import * as io from '@actions/io'
import * as path from 'path'
import * as thc from 'typed-rest-client/HttpClient.js'
import { minimatch } from 'minimatch'

import { DownloadMetaData, GithubRelease } from './gh-api.js'
import { IHeaders, IHttpClientResponse } from 'typed-rest-client/Interfaces.js'

import { IReleaseDownloadSettings } from './download-settings.js'
import {
  HttpError,
  AssetNotFoundError,
  ConfigError,
  ReleaseDownloaderError,
  FileNotFoundError,
  IncompleteDownloadError,
  RateLimitError
} from './errors.js'

export class ReleaseDownloader {
  private httpClient: thc.HttpClient

  private apiRoot: string

  /** Retry policy shared by the release metadata lookups and asset downloads */
  private static readonly RETRY_DELAY_MS = 30_000
  private static readonly MAX_RETRIES = 3
  /**
   * Attempts that resumed an asset and got further through it, which do not
   * count against MAX_RETRIES. Each one leaves the file strictly larger, so
   * the download ends either way; this only bounds how long it can take.
   */
  private static readonly MAX_RESUMES = 10

  /**
   * Rate-limit waits for one request, which do not count against MAX_RETRIES
   * either: three tries 30s apart is over in a minute, and GitHub's secondary
   * limits outlast that. Without a header saying how long to wait, the first
   * wait is a minute and each one after doubles it, as GitHub asks.
   */
  private static readonly MAX_RATE_LIMIT_WAITS = 5
  private static readonly RATE_LIMIT_BASE_DELAY_MS = 60_000

  /**
   * Until when every request holds off, because one of them was rate limited.
   * The limit is per user, not per request, so the other download workers
   * carrying on would only extend it.
   */
  private rateLimitedUntil = 0

  // Client errors worth retrying. Every server error is retried as well - see
  // isRetryableServerError - so no 5xx code is listed here.
  private static readonly RETRYABLE_ASSET_STATUS_CODES = new Set([
    // 401/403 are included because GitHub redirects asset downloads to signed
    // S3/blob URLs that intermittently return these mid-run even with a valid
    // token; retrying recovers from those transient blips.
    401, 403, 408, 429
  ])

  private static readonly RETRYABLE_API_STATUS_CODES = new Set([
    // A rate-limited 403 or 429 never reaches this list - backOffIfRateLimited
    // waits those out first - so these cover the ones GitHub sends without
    // saying it is rate limiting. 401 is
    // absent: an API call carries our own token with no signed-URL redirect in
    // the way, so a 401 is a bad token and will fail identically every time.
    403, 408, 429
  ])

  private static readonly RETRYABLE_ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'ENOTFOUND',
    'EAI_AGAIN',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT'
  ])

  constructor(httpClient: thc.HttpClient, githubApiUrl: string) {
    this.httpClient = httpClient
    this.apiRoot = githubApiUrl
  }

  async download(
    downloadSettings: IReleaseDownloadSettings
  ): Promise<string[]> {
    let ghRelease: GithubRelease

    if (downloadSettings.isLatest) {
      ghRelease = await this.getlatestRelease(
        downloadSettings.sourceRepoPath,
        downloadSettings.preRelease
      )
    } else if (downloadSettings.tag !== '') {
      ghRelease = await this.getReleaseByTag(
        downloadSettings.sourceRepoPath,
        downloadSettings.tag
      )
    } else if (downloadSettings.id !== '') {
      ghRelease = await this.getReleaseById(
        downloadSettings.sourceRepoPath,
        downloadSettings.id
      )
    } else {
      throw new ConfigError(
        'Please input a valid tag or release ID, or specify `latest`'
      )
    }

    const resolvedAssets: DownloadMetaData[] = this.resolveAssets(
      ghRelease,
      downloadSettings
    )

    const result = await this.downloadReleaseAssets(
      resolvedAssets,
      downloadSettings.outFilePath
    )

    // Set the output variables for use by other actions
    core.setOutput('tag_name', ghRelease.tag_name)
    core.setOutput('release_name', ghRelease.name)
    core.setOutput('downloaded_files', result)

    return result
  }

  /**
   * Performs a GitHub API request and returns its parsed JSON body, retrying
   * transient network failures and server-side errors.
   *
   * These lookups read a few KB, but they gate every download that follows: a
   * single dropped connection here failed the whole action, while the far
   * larger asset downloads had been retried all along.
   * @param url The API endpoint to read
   * @param operation Human readable description, used in error messages
   */
  private async fetchReleaseMetadata<T>(
    url: string,
    operation: string
  ): Promise<T> {
    const headers: IHeaders = { Accept: 'application/vnd.github.v3+json' }
    let failures = 0
    let rateLimitWaits = 0

    for (;;) {
      let response: IHttpClientResponse
      let responseBody: string | undefined

      await this.waitOutRateLimit()

      try {
        response = await this.httpClient.get(url, headers)

        // Read the body inside the same try as the request: a connection
        // dropped mid-response fails here rather than above, and is just as
        // worth retrying as one that never delivered a status at all.
        if (response.message.statusCode === 200) {
          responseBody = await response.readBody()
        }
      } catch (error) {
        if (
          this.isRetryableNetworkError(error) &&
          ++failures < ReleaseDownloader.MAX_RETRIES
        ) {
          core.warning(
            `Received transient network error on ${operation}, retrying in ${ReleaseDownloader.RETRY_DELAY_MS / 1000}s...`
          )
          await this.delay(ReleaseDownloader.RETRY_DELAY_MS)
          continue
        }

        throw error
      }

      if (responseBody !== undefined) {
        return JSON.parse(responseBody) as T
      }

      if (
        await this.backOffIfRateLimited(
          response,
          rateLimitWaits,
          operation,
          url
        )
      ) {
        rateLimitWaits++
        continue
      }

      if (
        this.isRetryableApiStatusCode(response.message.statusCode) &&
        ++failures < ReleaseDownloader.MAX_RETRIES
      ) {
        core.warning(
          `Received ${response.message.statusCode} on ${operation}, retrying in ${ReleaseDownloader.RETRY_DELAY_MS / 1000}s...`
        )
        await this.delay(ReleaseDownloader.RETRY_DELAY_MS)
        continue
      }

      throw new HttpError(response.message.statusCode ?? 0, operation, url)
    }
  }

  /**
   * Gets the latest release metadata from github api
   * @param repoPath The source repository path. {owner}/{repo}
   */
  private async getlatestRelease(
    repoPath: string,
    preRelease: boolean
  ): Promise<GithubRelease> {
    core.info(`Fetching latest release for repo ${repoPath}`)

    const operation = `Fetch latest release for '${repoPath}'`

    const url = !preRelease
      ? `${this.apiRoot}/repos/${repoPath}/releases/latest`
      : `${this.apiRoot}/repos/${repoPath}/releases`

    let release: GithubRelease
    if (!preRelease) {
      release = await this.fetchReleaseMetadata<GithubRelease>(url, operation)
      core.info(`Found latest release version: ${release.tag_name}`)
    } else {
      const allReleases = await this.fetchReleaseMetadata<GithubRelease[]>(
        url,
        operation
      )
      const latestPreRelease: GithubRelease | undefined = allReleases.find(
        r => r.prerelease === true
      )

      if (latestPreRelease) {
        release = latestPreRelease
        core.info(`Found latest pre-release version: ${release.tag_name}`)
      } else {
        throw new ReleaseDownloaderError(
          `No prereleases found for repository '${repoPath}'`
        )
      }
    }

    return release
  }

  /**
   * Gets release data of the specified tag
   * @param repoPath The source repository
   * @param tag The github tag to fetch release from.
   */
  private async getReleaseByTag(
    repoPath: string,
    tag: string
  ): Promise<GithubRelease> {
    core.info(`Fetching release ${tag} from repo ${repoPath}`)

    if (tag === '') {
      throw new ConfigError('Please input a valid tag')
    }

    const url = `${this.apiRoot}/repos/${repoPath}/releases/tags/${tag}`

    const release = await this.fetchReleaseMetadata<GithubRelease>(
      url,
      `Fetch release by tag '${tag}' for '${repoPath}'`
    )
    core.info(`Found release tag: ${release.tag_name}`)

    return release
  }

  /**
   * Gets release data of the specified release ID
   * @param repoPath The source repository
   * @param id The github release ID to fetch.
   */
  private async getReleaseById(
    repoPath: string,
    id: string
  ): Promise<GithubRelease> {
    core.info(`Fetching release id:${id} from repo ${repoPath}`)

    if (id === '') {
      throw new ConfigError('Please input a valid release ID')
    }

    const url = `${this.apiRoot}/repos/${repoPath}/releases/${id}`

    const release = await this.fetchReleaseMetadata<GithubRelease>(
      url,
      `Fetch release by ID '${id}' for '${repoPath}'`
    )
    core.info(`Found release tag: ${release.tag_name}`)

    return release
  }

  private resolveAssets(
    ghRelease: GithubRelease,
    downloadSettings: IReleaseDownloadSettings
  ): DownloadMetaData[] {
    const downloads: DownloadMetaData[] = []

    if (downloadSettings.fileName.length > 0) {
      if (ghRelease && ghRelease.assets.length > 0) {
        const availableAssetNames = ghRelease.assets.map(a => a.name)

        for (const asset of ghRelease.assets) {
          // download only matching file names
          if (!minimatch(asset.name, downloadSettings.fileName)) {
            continue
          }

          const dData: DownloadMetaData = {
            fileName: asset.name,
            url: asset['url'],
            isTarBallOrZipBall: false,
            expectedSize: asset.size
          }
          downloads.push(dData)
        }

        if (downloads.length === 0) {
          throw new AssetNotFoundError(
            downloadSettings.fileName,
            availableAssetNames
          )
        }
      } else {
        throw new AssetNotFoundError(downloadSettings.fileName, [])
      }
    }

    if (downloadSettings.tarBall) {
      const repoName = downloadSettings.sourceRepoPath.split('/')[1]
      downloads.push({
        fileName: `${repoName}-${ghRelease.tag_name}.tar.gz`,
        url: ghRelease.tarball_url,
        isTarBallOrZipBall: true
      })
    }

    if (downloadSettings.zipBall) {
      const repoName = downloadSettings.sourceRepoPath.split('/')[1]
      downloads.push({
        fileName: `${repoName}-${ghRelease.tag_name}.zip`,
        url: ghRelease.zipball_url,
        isTarBallOrZipBall: true
      })
    }

    return downloads
  }

  /** Max concurrent download requests to avoid GitHub rate limiting (403) */
  private static readonly DOWNLOAD_CONCURRENCY = 30

  /**
   * Downloads the specified assets from a given URL, capping the number of
   * requests in flight to avoid triggering GitHub rate limits when many assets
   * are downloaded at once.
   *
   * Assets are pulled from a shared queue by a pool of workers rather than
   * downloaded in fixed batches. Release assets vary in size by several orders
   * of magnitude, so a batch barrier would leave most slots idle waiting on the
   * largest file in each batch.
   * @param dData The download metadata
   * @param out Target directory
   */
  private async downloadReleaseAssets(
    dData: DownloadMetaData[],
    out: string
  ): Promise<string[]> {
    const outFileDir = path.resolve(out)

    if (!fs.existsSync(outFileDir)) {
      await io.mkdirP(outFileDir)
    }

    // Results are written by index so the returned paths stay in the same
    // order as the assets, regardless of the order downloads complete in.
    const result: string[] = new Array<string>(dData.length)
    let next = 0
    let failed = false

    // Safe without locking: `next++` runs synchronously between awaits.
    const worker = async (): Promise<void> => {
      while (next < dData.length && !failed) {
        const index = next++
        try {
          result[index] = await this.downloadFile(dData[index], out)
        } catch (error) {
          // Stop the other workers picking up new assets; a failed download
          // fails the action, so continuing the queue is wasted work.
          failed = true
          throw error
        }
      }
    }

    const workerCount = Math.min(
      ReleaseDownloader.DOWNLOAD_CONCURRENCY,
      dData.length
    )
    await Promise.all(Array.from({ length: workerCount }, async () => worker()))

    return result
  }

  private async downloadFile(
    asset: DownloadMetaData,
    outputPath: string
  ): Promise<string> {
    const outFilePath = path.resolve(outputPath, asset.fileName)

    // Bytes of this asset already on disk from an earlier attempt of this
    // call. Only ever set from a file this call wrote: a file left behind by
    // another run may be a different release's copy of the asset.
    let resumeFrom = 0
    let wroteFile = false
    let etag: string | undefined
    let failures = 0
    let resumes = 0
    let rateLimitWaits = 0

    // Every way an attempt can fail ends here. Returns whether to try again.
    // An attempt that left more of the asset on disk than it started with
    // does not spend the retry budget: on a link that drops every few
    // seconds, each attempt gets further, and restarting from zero meant a
    // large asset never got all the way through.
    const retryAfter = async (reason: string): Promise<boolean> => {
      const partialSize = wroteFile
        ? this.getResumableSize(asset, outFilePath)
        : 0
      const progressed = partialSize > resumeFrom
      resumeFrom = partialSize

      if (progressed && resumes < ReleaseDownloader.MAX_RESUMES) {
        resumes++
      } else if (++failures >= ReleaseDownloader.MAX_RETRIES) {
        return false
      }

      core.warning(
        `${reason}, retrying in ${ReleaseDownloader.RETRY_DELAY_MS / 1000}s...`
      )
      await this.delay(ReleaseDownloader.RETRY_DELAY_MS)
      return true
    }

    for (let attempt = 1; ; attempt++) {
      const headers: IHeaders = {
        Accept: asset.isTarBallOrZipBall ? '*/*' : 'application/octet-stream'
      }

      if (resumeFrom > 0) {
        headers['Range'] = `bytes=${resumeFrom}-`
        // Without a validator a resume could splice two different files
        // together if the asset were replaced between attempts. GitHub's blob
        // storage ignores If-Range, so the ETag is also compared below.
        if (etag !== undefined) {
          headers['If-Range'] = etag
        }
        core.info(
          `Resuming download of ${asset.fileName} from byte ${resumeFrom} of ${asset.expectedSize} (attempt ${attempt})`
        )
      } else {
        core.info(
          `Downloading file: ${asset.fileName} to: ${outputPath} (attempt ${attempt})`
        )
      }

      await this.waitOutRateLimit()

      let response: IHttpClientResponse
      try {
        response = await this.httpClient.get(asset.url, headers)
      } catch (error) {
        if (
          this.isRetryableNetworkError(error) &&
          (await retryAfter(
            `Received transient network error downloading ${asset.fileName}`
          ))
        ) {
          continue
        }

        throw error
      }

      const statusCode = response.message.statusCode
      const append =
        statusCode === 206 &&
        resumeFrom > 0 &&
        this.getContentRangeStart(response) === resumeFrom &&
        (etag === undefined || this.getStrongEtag(response) === etag)

      if (statusCode === 200 || append) {
        etag = this.getStrongEtag(response) ?? etag
        wroteFile = true
        try {
          return await this.saveFile(
            outputPath,
            asset.fileName,
            response,
            asset.expectedSize,
            append
          )
        } catch (error) {
          if (
            error instanceof IncompleteDownloadError &&
            (await retryAfter(error.message))
          ) {
            continue
          }

          throw error
        }
      }

      // Ahead of the resume handling: a rate-limited resume leaves the partial
      // file as it was, and asking for the same range again is still right.
      if (
        await this.backOffIfRateLimited(
          response,
          rateLimitWaits,
          `Download asset '${asset.fileName}'`,
          asset.url
        )
      ) {
        rateLimitWaits++
        continue
      }

      // The server answered a resume with a range other than the one asked
      // for, a different version of the asset, or nothing it could serve - the
      // partial file no longer lines up with it, so start again from the top.
      if (resumeFrom > 0 && (statusCode === 206 || statusCode === 416)) {
        response.message.resume()
        await io.rmRF(outFilePath)
        resumeFrom = 0
        etag = undefined
        if (
          await retryAfter(
            `Received ${statusCode} resuming ${asset.fileName}, restarting it from the beginning`
          )
        ) {
          continue
        }
      } else if (
        this.isRetryableAssetStatusCode(statusCode) &&
        (await retryAfter(
          `Received ${statusCode} downloading ${asset.fileName}`
        ))
      ) {
        continue
      }

      throw new HttpError(
        statusCode ?? 0,
        `Download asset '${asset.fileName}'`,
        asset.url
      )
    }
  }

  /**
   * How much of an asset a failed attempt left on disk that the next attempt
   * can resume from. Zero when there is nothing to resume: no file, a file
   * already at or past the asset's size, or an asset GitHub publishes no size
   * for - tarballs and zipballs are generated per request, so a later request
   * has no reason to produce the same bytes.
   */
  private getResumableSize(
    asset: DownloadMetaData,
    outFilePath: string
  ): number {
    if (asset.expectedSize === undefined || !fs.existsSync(outFilePath)) {
      return 0
    }

    const size = fs.statSync(outFilePath).size
    return size < asset.expectedSize ? size : 0
  }

  private getContentRangeStart(
    response: IHttpClientResponse
  ): number | undefined {
    const contentRange = response.message.headers['content-range']
    const match = /^bytes (\d+)-/.exec(contentRange ?? '')
    return match ? Number(match[1]) : undefined
  }

  /** If-Range only accepts a strong validator; a weak one is ignored. */
  private getStrongEtag(response: IHttpClientResponse): string | undefined {
    const etag = response.message.headers['etag']
    return typeof etag === 'string' && !etag.startsWith('W/') ? etag : undefined
  }

  /**
   * Whether a response is GitHub rate limiting us and, if so, how long to
   * wait: what its headers say when they say it, otherwise a minute doubled
   * for each wait already spent on this request. Undefined when it is not a
   * rate limit.
   *
   * A 403 is only a rate limit when GitHub says so. Blob storage behind the
   * asset redirect answers 403 for its own reasons, and those keep the plain
   * retry they had. With no rate-limit headers, the secondary limit is told
   * apart by the message in its body.
   */
  private async getRateLimitWait(
    response: IHttpClientResponse,
    waitsSoFar: number
  ): Promise<number | undefined> {
    const statusCode = response.message.statusCode
    if (statusCode !== 403 && statusCode !== 429) {
      return undefined
    }

    const headers = response.message.headers
    const retryAfter = Number(headers['retry-after'])
    if (headers['retry-after'] !== undefined && Number.isFinite(retryAfter)) {
      return retryAfter * 1000
    }

    const reset = Number(headers['x-ratelimit-reset'])
    if (headers['x-ratelimit-remaining'] === '0' && Number.isFinite(reset)) {
      return Math.max(reset * 1000 - Date.now(), 0)
    }

    if (statusCode === 403) {
      let body = ''
      try {
        body = await response.readBody()
      } catch {
        // A body that cannot be read says nothing either way
      }
      if (!/rate limit/i.test(body)) {
        return undefined
      }
    }

    return ReleaseDownloader.RATE_LIMIT_BASE_DELAY_MS * 2 ** waitsSoFar
  }

  /**
   * Holds every request off until the rate limit has had its wait, and
   * returns true, when a response was rate limited. Returns false for any
   * other response, and throws once a request has used up its waits.
   */
  private async backOffIfRateLimited(
    response: IHttpClientResponse,
    waitsSoFar: number,
    operation: string,
    url: string
  ): Promise<boolean> {
    const wait = await this.getRateLimitWait(response, waitsSoFar)
    if (wait === undefined) {
      return false
    }

    const statusCode = response.message.statusCode ?? 0
    if (waitsSoFar >= ReleaseDownloader.MAX_RATE_LIMIT_WAITS) {
      throw new RateLimitError(statusCode, operation, url, waitsSoFar)
    }

    this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + wait)
    core.warning(
      `Rate limited by GitHub (HTTP ${statusCode}) on ${operation}, holding all requests for ${Math.ceil(wait / 1000)}s...`
    )
    return true
  }

  private async waitOutRateLimit(): Promise<void> {
    const remaining = this.rateLimitedUntil - Date.now()
    if (remaining > 0) {
      await this.delay(remaining)
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private isRetryableAssetStatusCode(statusCode?: number): boolean {
    if (statusCode === undefined) {
      return false
    }

    return (
      this.isRetryableServerError(statusCode) ||
      ReleaseDownloader.RETRYABLE_ASSET_STATUS_CODES.has(statusCode)
    )
  }

  private isRetryableApiStatusCode(statusCode?: number): boolean {
    if (statusCode === undefined) {
      return false
    }

    return (
      this.isRetryableServerError(statusCode) ||
      ReleaseDownloader.RETRYABLE_API_STATUS_CODES.has(statusCode)
    )
  }

  /**
   * Any status from 500 up. The asset download is redirected to blob storage,
   * which has answered with codes no list anticipated - an HTTP 618 failed a
   * download outright while the error message, which already treats every
   * code from 500 up as a server error, called it "likely temporary". Retrying
   * by range keeps the retry decision and that message in agreement.
   */
  private isRetryableServerError(statusCode: number): boolean {
    return statusCode >= 500
  }

  private isRetryableNetworkError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false
    }

    const errorCode = (error as { code?: string }).code
    if (
      errorCode !== undefined &&
      ReleaseDownloader.RETRYABLE_ERROR_CODES.has(errorCode)
    ) {
      return true
    }

    const message = (
      (error as { message?: string }).message ?? ''
    ).toLowerCase()
    return (
      message.includes('socket hang up') ||
      message.includes('timed out') ||
      message.includes('timeout') ||
      message.includes('network error')
    )
  }

  /**
   * Streams a response body to disk, and checks it arrived whole.
   *
   * A 200 only says the body started. A connection that drops partway can
   * still end the stream cleanly, leaving a truncated file that looks like a
   * successful download - a cut-off JSON asset then fails whatever parses it,
   * steps later and on every retry of that step, with nothing pointing back
   * here. Comparing the bytes written against the size GitHub reports for the
   * asset catches that at the source, where a fresh request can still fix it.
   * @param expectedSize Byte count GitHub reports for the asset, when known
   */
  private async saveFile(
    outputPath: string,
    fileName: string,
    httpClientResponse: IHttpClientResponse,
    expectedSize?: number,
    append = false
  ): Promise<string> {
    const outFilePath: string = path.resolve(outputPath, fileName)
    const fileStream: fs.WriteStream = fs.createWriteStream(outFilePath, {
      flags: append ? 'a' : 'w'
    })

    return new Promise((resolve, reject) => {
      let streamError: Error | undefined

      // Handle errors on BOTH streams
      httpClientResponse.message.on('error', err => {
        // pipe() does not end the destination when the source fails, so close
        // it here rather than leave the handle open across a retry. The
        // rejection waits for 'close': the next attempt resumes from the
        // file's size, which is only final once buffered writes have landed.
        // end() rather than destroy(): destroying a file stream with a write
        // in flight makes it emit its own error, which would settle this as
        // a failed write to disk instead of a cut-off to resume.
        streamError = err
        httpClientResponse.message.unpipe(fileStream)
        fileStream.end()
      })
      fileStream.on('error', err =>
        reject(
          new ReleaseDownloaderError(
            `Failed to write '${fileName}': ${err.message}`,
            { fileName, outFilePath }
          )
        )
      )

      const outStream = httpClientResponse.message.pipe(fileStream)

      outStream.on('close', () => {
        if (streamError !== undefined) {
          reject(
            new IncompleteDownloadError(
              fileName,
              outFilePath,
              `download stream failed: ${streamError.message}`
            )
          )
          return
        }

        // Verify file exists and has content
        if (!fs.existsSync(outFilePath)) {
          reject(
            new FileNotFoundError(
              outFilePath,
              'Download verification',
              'The file was not created. This may indicate a network or permissions issue.'
            )
          )
          return
        }
        const stats = fs.statSync(outFilePath)
        if (expectedSize !== undefined && stats.size !== expectedSize) {
          reject(
            new IncompleteDownloadError(
              fileName,
              outFilePath,
              `received ${stats.size} of ${expectedSize} bytes`
            )
          )
          return
        }
        core.info(`Downloaded ${fileName} (${stats.size} bytes)`)
        resolve(outFilePath)
      })
    })
  }
}
