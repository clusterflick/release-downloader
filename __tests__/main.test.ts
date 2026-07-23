import { jest } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import * as handlers from 'typed-rest-client/Handlers.js'
import * as io from '@actions/io'
import * as thc from 'typed-rest-client/HttpClient.js'
import { fileURLToPath } from 'url'

import { IReleaseDownloadSettings } from '../src/download-settings.js'
import { ReleaseDownloader } from '../src/release-downloader.js'
import nock from 'nock'
import { extract } from '../src/unarchive.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let downloader: ReleaseDownloader
let httpClent: thc.HttpClient
const outputFilePath = './test-output'

beforeEach(() => {
  const githubtoken = process.env.REPO_TOKEN || ''
  const githubApiUrl = 'https://api.github.com'

  const credentialHandler = new handlers.BearerCredentialHandler(
    githubtoken,
    false
  )
  httpClent = new thc.HttpClient('gh-api-client', [credentialHandler])
  downloader = new ReleaseDownloader(httpClent, githubApiUrl)

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(200, readFromFile('1-release-latest.json'))

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/68092191')
    .reply(200, readFromFile('1-release-latest.json'))

  nock('https://api.github.com')
    .get('/repos/robinraju/foo-app/releases/tags/1.0.0')
    .reply(200, readFromFile('3-empty-assets.json'))

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946546')
    .replyWithFile(200, `${__dirname}/resource/assets/test-1.txt`)

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946547')
    .replyWithFile(200, `${__dirname}/resource/assets/test-2.txt`)

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946548')
    .replyWithFile(200, `${__dirname}/resource/assets/3-test.txt`)

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946549')
    .replyWithFile(200, `${__dirname}/resource/assets/downloader-test.pdf`)

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946550')
    .replyWithFile(200, `${__dirname}/resource/assets/lorem-ipsum.pdf`)

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946552')
    .replyWithFile(200, `${__dirname}/resource/assets/archive-example.zip`)

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946551')
    .replyWithFile(200, `${__dirname}/resource/assets/file_example.csv`)

  nock('https://my-gh-host.com/api/v3')
    .get('/repos/my-enterprise/test-repo/releases/latest')
    .reply(200, readFromFile('2-gh-enterprise.json'))

  nock('https://my-gh-host.com/api/v3', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/my-enterprise/test-repo/releases/assets/66946546')
    .replyWithFile(200, `${__dirname}/resource/assets/test-1.txt`)

  nock('https://api.github.com/')
    .get('/repos/robinraju/slick-pg/releases')
    .reply(200, readFromFile('4-with-prerelease.json'))

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/slick-pg/releases/assets/66946546')
    .replyWithFile(200, `${__dirname}/resource/assets/pre-release.txt`)

  nock('https://api.github.com/')
    .get('/repos/foo/slick-pg/releases')
    .reply(200, readFromFile('5-without-prerelease.json'))

  nock('https://api.github.com')
    .get('/repos/robinraju/tar-zip-ball-only-repo/releases/latest')
    .reply(200, readFromFile('6-tar-zip-ball-only-repo.json'))

  nock('https://api.github.com', {
    reqheaders: { accept: '*/*' }
  })
    .get('/repos/robinraju/tar-zip-ball-only-repo/tarball/1.0.0')
    .replyWithFile(
      200,
      `${__dirname}/resource/assets/tar-zip-ball-only-repo.tar.gz`
    )

  nock('https://api.github.com', {
    reqheaders: { accept: '*/*' }
  })
    .get('/repos/robinraju/tar-zip-ball-only-repo/zipball/1.0.0')
    .replyWithFile(
      200,
      `${__dirname}/resource/assets/tar-zip-ball-only-repo.zip`
    )
})

afterEach(async () => {
  await io.rmRF(outputFilePath)
})

function readFromFile(fileName: string): string {
  const fileContents = fs.readFileSync(`${__dirname}/resource/${fileName}`, {
    encoding: 'utf-8'
  })
  return normalizeLineEndings(fileContents)
}

function normalizeLineEndings(str: string): string {
  // Normalize all line endings to LF (\n)
  return str.replace(/\r\n/g, '\n')
}

test('Download all files from public repo', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: '*',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(7)
}, 10000)

test('Download single file from public repo', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: 'test-1.txt',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(1)
}, 10000)

test('Fail loudly if given filename is not found in a release', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: 'missing-file.txt',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = downloader.download(downloadSettings)
  await expect(result).rejects.toThrow(
    "No asset matching 'missing-file.txt' found in release"
  )
}, 10000)

test('Fail loudly if release is not identified', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: false,
    preRelease: false,
    tag: '',
    id: '',
    fileName: 'missing-file.txt',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = downloader.download(downloadSettings)
  await expect(result).rejects.toThrow(
    'Please input a valid tag or release ID, or specify `latest`'
  )
}, 10000)

test('Download files with wildcard from public repo', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: 'test-*.txt',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(2)
}, 10000)

test('Download single file with wildcard from public repo', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: '3-*.txt',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(1)
}, 10000)

test('Download multiple pdf files with wildcard filename', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: '*.pdf',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(2)
}, 10000)

test('Download a csv file with wildcard filename', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: '*.csv',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(1)
}, 10000)

test('Download file from Github Enterprise server', async () => {
  downloader = new ReleaseDownloader(httpClent, 'https://my-gh-host.com/api/v3')

  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'my-enterprise/test-repo',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: 'test-1.txt',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(1)
}, 10000)

test('Download file from release identified by ID', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: false,
    preRelease: false,
    tag: '',
    id: '68092191',
    fileName: 'test-2.txt',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(1)
}, 10000)

test('Download all archive files from public repo', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: '*.zip',
    tarBall: false,
    zipBall: false,
    extractAssets: true,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = await downloader.download(downloadSettings)
  if (downloadSettings.extractAssets) {
    for (const asset of result) {
      await extract(asset, downloadSettings.outFilePath)
    }
  }

  expect(result.length).toBe(1)
  expect(
    fs.existsSync(path.join(downloadSettings.outFilePath, 'test-3.txt'))
  ).toBe(true)

  const extractedFilePath = path.join(
    downloadSettings.outFilePath,
    'test-4.txt'
  )
  expect(fs.existsSync(extractedFilePath)).toBe(true)

  const actualContent = fs.readFileSync(extractedFilePath, {
    encoding: 'utf-8'
  })
  const expectedContent = readFromFile('assets/archive-example-test-4.txt')

  expect(normalizeLineEndings(actualContent)).toBe(expectedContent)
}, 10000)

test('Fail when a release with no assets are obtained', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/foo-app',
    isLatest: false,
    preRelease: false,
    tag: '1.0.0',
    id: '',
    fileName: 'installer.zip',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = downloader.download(downloadSettings)
  await expect(result).rejects.toThrow(
    "No asset matching 'installer.zip' found in release. Available assets: (no assets in release)"
  )
}, 10000)

test('Download from latest prerelease', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/slick-pg',
    isLatest: true,
    preRelease: true,
    tag: '',
    id: '',
    fileName: 'pre-release.txt',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(1)
}, 10000)

test('Fail when a release with no prerelease is obtained', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'foo/slick-pg',
    isLatest: true,
    preRelease: true,
    tag: '',
    id: '',
    fileName: 'installer.zip',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }
  const result = downloader.download(downloadSettings)
  await expect(result).rejects.toThrow(
    "No prereleases found for repository 'foo/slick-pg'"
  )
}, 10000)

test('Download from a release containing only tarBall & zipBall', async () => {
  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/tar-zip-ball-only-repo',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: '',
    tarBall: true,
    zipBall: true,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }

  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(2)
})

test('Retry asset download on socket hang up', async () => {
  nock.cleanAll()

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(200, readFromFile('1-release-latest.json'))

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946546')
    .replyWithError('socket hang up')
    .get('/repos/robinraju/probable-potato/releases/assets/66946546')
    .replyWithFile(200, `${__dirname}/resource/assets/test-1.txt`)

  const delaySpy = jest
    .spyOn(
      downloader as unknown as { delay: (ms: number) => Promise<void> },
      'delay'
    )
    .mockResolvedValue(undefined)

  const downloadSettings: IReleaseDownloadSettings = {
    sourceRepoPath: 'robinraju/probable-potato',
    isLatest: true,
    preRelease: false,
    tag: '',
    id: '',
    fileName: 'test-1.txt',
    tarBall: false,
    zipBall: false,
    extractAssets: false,
    outFilePath: outputFilePath,
    extractPath: outputFilePath
  }

  const result = await downloader.download(downloadSettings)
  expect(result.length).toBe(1)
  expect(delaySpy).toHaveBeenCalledTimes(1)

  delaySpy.mockRestore()
})

const retrySettings = (fileName: string): IReleaseDownloadSettings => ({
  sourceRepoPath: 'robinraju/probable-potato',
  isLatest: true,
  preRelease: false,
  tag: '',
  id: '',
  fileName,
  tarBall: false,
  zipBall: false,
  extractAssets: false,
  outFilePath: outputFilePath,
  extractPath: outputFilePath
})

test('Retry asset download on retryable status code', async () => {
  nock.cleanAll()

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(200, readFromFile('1-release-latest.json'))

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946546')
    .reply(503, 'Service Unavailable')
    .get('/repos/robinraju/probable-potato/releases/assets/66946546')
    .replyWithFile(200, `${__dirname}/resource/assets/test-1.txt`)

  const delaySpy = jest
    .spyOn(
      downloader as unknown as { delay: (ms: number) => Promise<void> },
      'delay'
    )
    .mockResolvedValue(undefined)

  const result = await downloader.download(retrySettings('test-1.txt'))
  expect(result.length).toBe(1)
  expect(delaySpy).toHaveBeenCalledTimes(1)

  delaySpy.mockRestore()
})

test('Fail asset download after exhausting retries', async () => {
  nock.cleanAll()

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(200, readFromFile('1-release-latest.json'))

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946546')
    .times(3)
    .reply(503, 'Service Unavailable')

  const delaySpy = jest
    .spyOn(
      downloader as unknown as { delay: (ms: number) => Promise<void> },
      'delay'
    )
    .mockResolvedValue(undefined)

  await expect(
    downloader.download(retrySettings('test-1.txt'))
  ).rejects.toThrow("Download asset 'test-1.txt'")
  expect(delaySpy).toHaveBeenCalledTimes(2)

  delaySpy.mockRestore()
})

test('Retry helpers classify status codes and network errors', async () => {
  const internal = downloader as unknown as {
    isRetryableStatusCode: (code?: number) => boolean
    isRetryableNetworkError: (err: unknown) => boolean
    delay: (ms: number) => Promise<void>
  }

  expect(internal.isRetryableStatusCode(503)).toBe(true)
  expect(internal.isRetryableStatusCode(401)).toBe(true)
  expect(internal.isRetryableStatusCode(403)).toBe(true)
  expect(internal.isRetryableStatusCode(200)).toBe(false)
  expect(internal.isRetryableStatusCode(undefined)).toBe(false)

  expect(internal.isRetryableNetworkError({ code: 'ECONNRESET' })).toBe(true)
  expect(internal.isRetryableNetworkError({ message: 'socket hang up' })).toBe(
    true
  )
  expect(internal.isRetryableNetworkError({ code: 'EACCES' })).toBe(false)
  expect(internal.isRetryableNetworkError(null)).toBe(false)
  expect(internal.isRetryableNetworkError('boom')).toBe(false)

  await expect(internal.delay(1)).resolves.toBeUndefined()
})

type DownloadInternals = {
  downloadFile: (asset: DownloadMetaData, out: string) => Promise<string>
  downloadReleaseAssets: (
    dData: DownloadMetaData[],
    out: string
  ) => Promise<string[]>
}

const fakeAssets = (count: number): DownloadMetaData[] =>
  Array.from({ length: count }, (_unused, i) => ({
    fileName: `asset-${i}.txt`,
    url: `https://api.github.com/assets/${i}`,
    isTarBallOrZipBall: false
  }))

test('Refill download slots without waiting on the slowest asset', async () => {
  const internal = downloader as unknown as DownloadInternals
  const assets = fakeAssets(40)

  const started = new Set<string>()
  let inFlight = 0
  let maxInFlight = 0
  let releaseSlowAsset: () => void = () => {}
  const slowAsset = new Promise<void>(resolve => {
    releaseSlowAsset = resolve
  })

  const downloadSpy = jest
    .spyOn(internal, 'downloadFile')
    .mockImplementation(async asset => {
      started.add(asset.fileName)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      // Asset 0 holds its slot until released, standing in for one very large
      // file queued alongside many small ones.
      if (asset.fileName === 'asset-0.txt') {
        await slowAsset
      }
      inFlight--
      return asset.fileName
    })

  const pending = internal.downloadReleaseAssets(assets, outputFilePath)
  await new Promise(resolve => setTimeout(resolve, 50))

  // Downloading in fixed batches of 30 could not have reached asset 30 yet,
  // because asset 0 is still holding the first batch open.
  expect(started.has('asset-30.txt')).toBe(true)
  expect(started.size).toBe(assets.length)
  expect(maxInFlight).toBeLessThanOrEqual(30)

  releaseSlowAsset()

  // Results follow input order, not completion order.
  await expect(pending).resolves.toEqual(assets.map(a => a.fileName))
  expect(downloadSpy).toHaveBeenCalledTimes(assets.length)

  downloadSpy.mockRestore()
})

test('Stop queuing further assets once a download fails', async () => {
  const internal = downloader as unknown as DownloadInternals
  const assets = fakeAssets(200)

  const downloadSpy = jest
    .spyOn(internal, 'downloadFile')
    .mockImplementation(async asset => {
      await new Promise(resolve => setTimeout(resolve, 1))
      if (asset.fileName === 'asset-0.txt') {
        throw new Error('boom')
      }
      return asset.fileName
    })

  await expect(
    internal.downloadReleaseAssets(assets, outputFilePath)
  ).rejects.toThrow('boom')

  const callsAtFailure = downloadSpy.mock.calls.length
  expect(callsAtFailure).toBeLessThan(assets.length)

  // Workers stop pulling from the queue rather than quietly downloading the
  // remaining assets in the background after the action has already failed.
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(downloadSpy).toHaveBeenCalledTimes(callsAtFailure)

  downloadSpy.mockRestore()
})
