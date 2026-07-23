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
  FileNotFoundError
} from './errors.js'

export class ReleaseDownloader {
  private httpClient: thc.HttpClient

  private apiRoot: string

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
   * Gets the latest release metadata from github api
   * @param repoPath The source repository path. {owner}/{repo}
   */
  private async getlatestRelease(
    repoPath: string,
    preRelease: boolean
  ): Promise<GithubRelease> {
    core.info(`Fetching latest release for repo ${repoPath}`)

    const headers: IHeaders = { Accept: 'application/vnd.github.v3+json' }

    const url = !preRelease
      ? `${this.apiRoot}/repos/${repoPath}/releases/latest`
      : `${this.apiRoot}/repos/${repoPath}/releases`

    const response = await this.httpClient.get(url, headers)

    if (response.message.statusCode !== 200) {
      throw new HttpError(
        response.message.statusCode ?? 0,
        `Fetch latest release for '${repoPath}'`,
        url
      )
    }

    const responseBody = await response.readBody()

    let release: GithubRelease
    if (!preRelease) {
      release = JSON.parse(responseBody.toString())
      core.info(`Found latest release version: ${release.tag_name}`)
    } else {
      const allReleases: GithubRelease[] = JSON.parse(responseBody.toString())
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

    const headers: IHeaders = { Accept: 'application/vnd.github.v3+json' }
    const url = `${this.apiRoot}/repos/${repoPath}/releases/tags/${tag}`

    const response = await this.httpClient.get(url, headers)

    if (response.message.statusCode !== 200) {
      throw new HttpError(
        response.message.statusCode ?? 0,
        `Fetch release by tag '${tag}' for '${repoPath}'`,
        url
      )
    }

    const responseBody = await response.readBody()
    const release: GithubRelease = JSON.parse(responseBody.toString())
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

    const headers: IHeaders = { Accept: 'application/vnd.github.v3+json' }
    const url = `${this.apiRoot}/repos/${repoPath}/releases/${id}`

    const response = await this.httpClient.get(url, headers)

    if (response.message.statusCode !== 200) {
      throw new HttpError(
        response.message.statusCode ?? 0,
        `Fetch release by ID '${id}' for '${repoPath}'`,
        url
      )
    }

    const responseBody = await response.readBody()
    const release: GithubRelease = JSON.parse(responseBody.toString())
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
            isTarBallOrZipBall: false
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

  private static readonly RETRY_DELAY_MS = 30_000
  private static readonly MAX_RETRIES = 3
  private static readonly RETRYABLE_STATUS_CODES = new Set([
    // 401/403 are included because GitHub redirects asset downloads to signed
    // S3/blob URLs that intermittently return these mid-run even with a valid
    // token; retrying recovers from those transient blips.
    401, 403, 408, 429, 500, 502, 503, 504
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

  private async downloadFile(
    asset: DownloadMetaData,
    outputPath: string
  ): Promise<string> {
    const headers: IHeaders = {
      Accept: 'application/octet-stream'
    }

    if (asset.isTarBallOrZipBall) {
      headers['Accept'] = '*/*'
    }

    for (let attempt = 1; attempt <= ReleaseDownloader.MAX_RETRIES; attempt++) {
      core.info(
        `Downloading file: ${asset.fileName} to: ${outputPath} (attempt ${attempt}/${ReleaseDownloader.MAX_RETRIES})`
      )

      let response: IHttpClientResponse
      try {
        response = await this.httpClient.get(asset.url, headers)
      } catch (error) {
        if (
          this.isRetryableNetworkError(error) &&
          attempt < ReleaseDownloader.MAX_RETRIES
        ) {
          core.warning(
            `Received transient network error downloading ${asset.fileName}, retrying in ${ReleaseDownloader.RETRY_DELAY_MS / 1000}s...`
          )
          await this.delay(ReleaseDownloader.RETRY_DELAY_MS)
          continue
        }

        throw error
      }

      if (response.message.statusCode === 200) {
        return this.saveFile(outputPath, asset.fileName, response)
      }

      if (
        this.isRetryableStatusCode(response.message.statusCode) &&
        attempt < ReleaseDownloader.MAX_RETRIES
      ) {
        core.warning(
          `Received ${response.message.statusCode} downloading ${asset.fileName}, retrying in ${ReleaseDownloader.RETRY_DELAY_MS / 1000}s...`
        )
        await this.delay(ReleaseDownloader.RETRY_DELAY_MS)
        continue
      }

      throw new HttpError(
        response.message.statusCode ?? 0,
        `Download asset '${asset.fileName}'`,
        asset.url
      )
    }

    throw new ReleaseDownloaderError(
      `Failed to download ${asset.fileName} after ${ReleaseDownloader.MAX_RETRIES} attempts`
    )
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private isRetryableStatusCode(statusCode?: number): boolean {
    if (statusCode === undefined) {
      return false
    }

    return ReleaseDownloader.RETRYABLE_STATUS_CODES.has(statusCode)
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

  private async saveFile(
    outputPath: string,
    fileName: string,
    httpClientResponse: IHttpClientResponse
  ): Promise<string> {
    const outFilePath: string = path.resolve(outputPath, fileName)
    const fileStream: fs.WriteStream = fs.createWriteStream(outFilePath)

    return new Promise((resolve, reject) => {
      // Handle errors on BOTH streams
      httpClientResponse.message.on('error', err =>
        reject(
          new ReleaseDownloaderError(
            `Download stream failed for '${fileName}': ${err.message}`,
            { fileName, outFilePath }
          )
        )
      )
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
        core.info(`Downloaded ${fileName} (${stats.size} bytes)`)
        resolve(outFilePath)
      })
    })
  }
}
