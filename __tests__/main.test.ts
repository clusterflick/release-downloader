import { jest } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { Readable } from 'stream'
import * as handlers from 'typed-rest-client/Handlers.js'
import * as io from '@actions/io'
import * as thc from 'typed-rest-client/HttpClient.js'
import { IHeaders, IHttpClientResponse } from 'typed-rest-client/Interfaces.js'
import { fileURLToPath } from 'url'

import { IReleaseDownloadSettings } from '../src/download-settings.js'
import { DownloadMetaData } from '../src/gh-api.js'
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

// Blob storage behind the asset redirect has answered with a server error no
// list anticipated - HTTP 618 - which used to fail the download on the first
// try. nock refuses statuses above 599, so an unlisted 5xx stands in for it
// here; the 618 itself is covered by the classification test below.
test('Retry asset download on an unlisted server error', async () => {
  nock.cleanAll()

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(200, readFromFile('1-release-latest.json'))

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946546')
    .reply(520, 'Unknown Error')
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

// A dropped connection can end the response stream cleanly, so a short body
// looks like a finished download unless it is checked against the asset's size.
test('Retry asset download when the body arrives truncated', async () => {
  nock.cleanAll()

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(200, readFromFile('1-release-latest.json'))

  const fullBody = fs.readFileSync(`${__dirname}/resource/assets/test-1.txt`)

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946546')
    .reply(200, fullBody.subarray(0, 10))
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
  expect(fs.readFileSync(result[0])).toEqual(fullBody)
  expect(delaySpy).toHaveBeenCalledTimes(1)

  delaySpy.mockRestore()
})

test('Fail asset download when every attempt arrives truncated', async () => {
  nock.cleanAll()

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(200, readFromFile('1-release-latest.json'))

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
    .get('/repos/robinraju/probable-potato/releases/assets/66946546')
    .times(4)
    .reply(200, 'truncated')

  const delaySpy = jest
    .spyOn(
      downloader as unknown as { delay: (ms: number) => Promise<void> },
      'delay'
    )
    .mockResolvedValue(undefined)

  await expect(
    downloader.download(retrySettings('test-1.txt'))
  ).rejects.toMatchObject({
    name: 'IncompleteDownloadError',
    message: "Incomplete download of 'test-1.txt': received 9 of 46 bytes"
  })
  // The first attempt got 9 bytes further than nothing, so it does not spend
  // the retry budget; the three that resume and get no further do.
  expect(delaySpy).toHaveBeenCalledTimes(3)

  delaySpy.mockRestore()
})

test('Retry release lookup on socket hang up', async () => {
  nock.cleanAll()

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .replyWithError('socket hang up')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(200, readFromFile('1-release-latest.json'))

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
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

test('Retry release lookup on retryable status code', async () => {
  nock.cleanAll()

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(503, 'Service Unavailable')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(200, readFromFile('1-release-latest.json'))

  nock('https://api.github.com', {
    reqheaders: { accept: 'application/octet-stream' }
  })
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

test('Fail release lookup after exhausting retries', async () => {
  nock.cleanAll()

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .times(3)
    .replyWithError('socket hang up')

  const delaySpy = jest
    .spyOn(
      downloader as unknown as { delay: (ms: number) => Promise<void> },
      'delay'
    )
    .mockResolvedValue(undefined)

  await expect(
    downloader.download(retrySettings('test-1.txt'))
  ).rejects.toThrow('socket hang up')
  expect(delaySpy).toHaveBeenCalledTimes(2)

  delaySpy.mockRestore()
})

test('Do not retry release lookup on an unauthorized response', async () => {
  nock.cleanAll()

  nock('https://api.github.com')
    .get('/repos/robinraju/probable-potato/releases/latest')
    .reply(401, 'Unauthorized')

  const delaySpy = jest
    .spyOn(
      downloader as unknown as { delay: (ms: number) => Promise<void> },
      'delay'
    )
    .mockResolvedValue(undefined)

  await expect(
    downloader.download(retrySettings('test-1.txt'))
  ).rejects.toThrow("Fetch latest release for 'robinraju/probable-potato'")
  expect(delaySpy).not.toHaveBeenCalled()

  delaySpy.mockRestore()
})

test('Retry helpers classify status codes and network errors', async () => {
  const internal = downloader as unknown as {
    isRetryableAssetStatusCode: (code?: number) => boolean
    isRetryableApiStatusCode: (code?: number) => boolean
    isRetryableNetworkError: (err: unknown) => boolean
    delay: (ms: number) => Promise<void>
  }

  expect(internal.isRetryableAssetStatusCode(503)).toBe(true)
  expect(internal.isRetryableAssetStatusCode(401)).toBe(true)
  expect(internal.isRetryableAssetStatusCode(403)).toBe(true)
  // Every server error is retried, including codes outside the standard set
  expect(internal.isRetryableAssetStatusCode(500)).toBe(true)
  expect(internal.isRetryableAssetStatusCode(618)).toBe(true)
  expect(internal.isRetryableAssetStatusCode(404)).toBe(false)
  expect(internal.isRetryableAssetStatusCode(200)).toBe(false)
  expect(internal.isRetryableAssetStatusCode(undefined)).toBe(false)

  expect(internal.isRetryableApiStatusCode(503)).toBe(true)
  expect(internal.isRetryableApiStatusCode(403)).toBe(true)
  // A 401 from the API is a bad token, not a blip, so it is not retried
  expect(internal.isRetryableApiStatusCode(401)).toBe(false)
  expect(internal.isRetryableApiStatusCode(505)).toBe(true)
  expect(internal.isRetryableApiStatusCode(618)).toBe(true)
  expect(internal.isRetryableApiStatusCode(404)).toBe(false)
  expect(internal.isRetryableApiStatusCode(200)).toBe(false)
  expect(internal.isRetryableApiStatusCode(undefined)).toBe(false)

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

// The real failure is the connection to blob storage dropping a few seconds
// into a large asset. nock reports an error raised partway through a body as
// its own unhandled error rather than on the response, so those cases stub
// the client's get() instead and record the headers each request was sent.
type StubReply = {
  status: number
  body?: Buffer
  headers?: Record<string, string>
  aborted?: boolean
  /** Deliver the body in chunks and cut the connection partway through */
  abortedMidFlow?: boolean
}

const stubAssetRequests = (
  replies: StubReply[]
): { requests: IHeaders[]; restore: () => void } => {
  const requests: IHeaders[] = []
  const spy = jest
    .spyOn(httpClent, 'get')
    .mockImplementation(async (_url, headers) => {
      requests.push({ ...headers })
      const reply = replies.shift()
      if (reply === undefined) {
        throw new Error('Unexpected request')
      }

      const message = new Readable({ read() {} })
      const body = reply.body ?? Buffer.alloc(0)
      if (reply.abortedMidFlow) {
        // A real socket keeps handing over data while the disk catches up, so
        // the cut lands with a write in flight.
        const chunkSize = 64 * 1024
        let offset = 0
        const pump = (): void => {
          if (offset >= body.length / 2) {
            message.destroy(new Error('aborted'))
            return
          }
          message.push(body.subarray(offset, offset + chunkSize))
          offset += chunkSize
          setImmediate(pump)
        }
        setImmediate(pump)
      } else if (reply.aborted) {
        message.push(body)
        // Cut the connection once the bytes before it have reached the disk,
        // as they will have seconds into a real download. Cutting it sooner
        // drops them while the file is still opening, leaving nothing to resume.
        setTimeout(() => message.destroy(new Error('aborted')), 50)
      } else {
        message.push(body)
        message.push(null)
      }
      return {
        message: Object.assign(message, {
          statusCode: reply.status,
          headers: reply.headers ?? {}
        })
      } as unknown as IHttpClientResponse
    })

  return { requests, restore: () => spy.mockRestore() }
}

const contentRange = (start: number, body: Buffer): Record<string, string> => ({
  'content-range': `bytes ${start}-${body.length - 1}/${body.length}`
})

const assetPath = '/repos/robinraju/probable-potato/releases/assets/66946546'
const assetBody = (): Buffer =>
  fs.readFileSync(`${__dirname}/resource/assets/test-1.txt`)
const resumableAsset = (): DownloadMetaData => ({
  fileName: 'test-1.txt',
  url: `https://api.github.com${assetPath}`,
  isTarBallOrZipBall: false,
  expectedSize: assetBody().length
})

const downloadFile = async (asset: DownloadMetaData): Promise<string> =>
  (downloader as unknown as DownloadInternals).downloadFile(
    asset,
    outputFilePath
  )

const mockDelay = (): ReturnType<typeof jest.spyOn> =>
  jest
    .spyOn(
      downloader as unknown as { delay: (ms: number) => Promise<void> },
      'delay'
    )
    .mockResolvedValue(undefined)

describe('Resuming a download that was cut off', () => {
  beforeEach(async () => {
    nock.cleanAll()
    await io.rmRF(path.resolve(outputFilePath, 'test-1.txt'))
    await io.mkdirP(outputFilePath)
  })

  test('asks for only the missing bytes, guarded by the ETag', async () => {
    const body = assetBody()
    const stub = stubAssetRequests([
      {
        status: 200,
        body: body.subarray(0, 10),
        headers: { etag: '"v1"' },
        aborted: true
      },
      {
        status: 206,
        body: body.subarray(10),
        headers: { ...contentRange(10, body), etag: '"v1"' }
      }
    ])
    const delaySpy = mockDelay()

    try {
      const result = await downloadFile(resumableAsset())
      expect(fs.readFileSync(result)).toEqual(body)
      expect(stub.requests[0]['Range']).toBeUndefined()
      expect(stub.requests[1]).toMatchObject({
        Range: 'bytes=10-',
        'If-Range': '"v1"'
      })
      expect(delaySpy).toHaveBeenCalledTimes(1)
    } finally {
      stub.restore()
      delaySpy.mockRestore()
    }
  })

  // GitHub's blob storage serves the range whatever If-Range says, so the
  // ETag is checked here too, or a replaced asset would be spliced onto the old.
  test('starts over when the asset changed between attempts', async () => {
    const body = assetBody()
    const stub = stubAssetRequests([
      {
        status: 200,
        body: body.subarray(0, 10),
        headers: { etag: '"v1"' },
        aborted: true
      },
      {
        status: 206,
        body: body.subarray(10),
        headers: { ...contentRange(10, body), etag: '"v2"' }
      },
      { status: 200, body, headers: { etag: '"v2"' } }
    ])
    const delaySpy = mockDelay()

    try {
      const result = await downloadFile(resumableAsset())
      expect(fs.readFileSync(result)).toEqual(body)
      expect(stub.requests[2]['Range']).toBeUndefined()
      expect(delaySpy).toHaveBeenCalledTimes(2)
    } finally {
      stub.restore()
      delaySpy.mockRestore()
    }
  })

  test('sends no If-Range for a weak ETag', async () => {
    const body = assetBody()

    nock('https://api.github.com')
      .get(assetPath)
      .reply(200, body.subarray(0, 10), { ETag: 'W/"v1"' })
    nock('https://api.github.com', {
      reqheaders: { range: 'bytes=10-' },
      badheaders: ['if-range']
    })
      .get(assetPath)
      .reply(206, body.subarray(10), {
        'Content-Range': `bytes 10-${body.length - 1}/${body.length}`
      })

    const delaySpy = mockDelay()

    const result = await downloadFile(resumableAsset())
    expect(fs.readFileSync(result)).toEqual(body)

    delaySpy.mockRestore()
  })

  test('starts over when the server ignores the range', async () => {
    const body = assetBody()

    nock('https://api.github.com')
      .get(assetPath)
      .reply(200, body.subarray(0, 10))
      .get(assetPath)
      .reply(200, body)

    const delaySpy = mockDelay()

    const result = await downloadFile(resumableAsset())
    expect(fs.readFileSync(result)).toEqual(body)

    delaySpy.mockRestore()
  })

  test.each([
    ['cannot serve the range', 416, {}],
    ['answers with a different range', 206, { 'Content-Range': 'bytes 0-9/46' }]
  ])(
    'discards the partial file when the server %s',
    async (_case, status, headers) => {
      const body = assetBody()

      nock('https://api.github.com')
        .get(assetPath)
        .reply(200, body.subarray(0, 10))
      nock('https://api.github.com', { reqheaders: { range: 'bytes=10-' } })
        .get(assetPath)
        .reply(status, 'nope', headers)
      nock('https://api.github.com', { badheaders: ['range'] })
        .get(assetPath)
        .reply(200, body)

      const delaySpy = mockDelay()

      const result = await downloadFile(resumableAsset())
      expect(fs.readFileSync(result)).toEqual(body)
      expect(delaySpy).toHaveBeenCalledTimes(2)
      expect(nock.isDone()).toBe(true)

      delaySpy.mockRestore()
    }
  )

  test('fails when a resume is refused on the last attempt', async () => {
    const body = assetBody()

    nock('https://api.github.com')
      .get(assetPath)
      .reply(200, body.subarray(0, 10))
      .get(assetPath)
      .reply(503)
      .get(assetPath)
      .reply(503)
      .get(assetPath)
      .reply(416)

    const delaySpy = mockDelay()

    await expect(downloadFile(resumableAsset())).rejects.toThrow(
      "Download asset 'test-1.txt'"
    )

    delaySpy.mockRestore()
  })

  // Five drops in a row, each getting further, would have failed outright
  // when every attempt counted against the three allowed.
  test('does not spend the retry budget on attempts that got further', async () => {
    const body = assetBody()
    const stub = stubAssetRequests([
      { status: 200, body: body.subarray(0, 5), aborted: true },
      ...[5, 10, 15, 20].map(start => ({
        status: 206,
        body: body.subarray(start, start + 5),
        headers: contentRange(start, body),
        aborted: true
      })),
      { status: 206, body: body.subarray(25), headers: contentRange(25, body) }
    ])
    const delaySpy = mockDelay()

    try {
      const result = await downloadFile(resumableAsset())
      expect(fs.readFileSync(result)).toEqual(body)
      expect(stub.requests.map(headers => headers['Range'])).toEqual([
        undefined,
        'bytes=5-',
        'bytes=10-',
        'bytes=15-',
        'bytes=20-',
        'bytes=25-'
      ])
      expect(delaySpy).toHaveBeenCalledTimes(5)
    } finally {
      stub.restore()
      delaySpy.mockRestore()
    }
  })

  test('counts progress against the budget once resumes run out', async () => {
    const limits = ReleaseDownloader as unknown as { MAX_RESUMES: number }
    const maxResumes = limits.MAX_RESUMES
    limits.MAX_RESUMES = 1

    const body = assetBody()
    const stub = stubAssetRequests([
      { status: 200, body: body.subarray(0, 5), aborted: true },
      ...[5, 10, 15].map(start => ({
        status: 206,
        body: body.subarray(start, start + 5),
        headers: contentRange(start, body),
        aborted: true
      }))
    ])
    const delaySpy = mockDelay()

    try {
      await expect(downloadFile(resumableAsset())).rejects.toMatchObject({
        name: 'IncompleteDownloadError',
        message:
          "Incomplete download of 'test-1.txt': download stream failed: aborted"
      })
      expect(stub.requests).toHaveLength(4)
      expect(delaySpy).toHaveBeenCalledTimes(3)
    } finally {
      limits.MAX_RESUMES = maxResumes
      stub.restore()
      delaySpy.mockRestore()
    }
  })

  test('never resumes from a file it did not write', async () => {
    const body = assetBody()
    fs.writeFileSync(
      path.resolve(outputFilePath, 'test-1.txt'),
      body.subarray(0, 10)
    )

    nock('https://api.github.com', { badheaders: ['range'] })
      .get(assetPath)
      .reply(503)
      .get(assetPath)
      .reply(200, body)

    const delaySpy = mockDelay()

    const result = await downloadFile(resumableAsset())
    expect(fs.readFileSync(result)).toEqual(body)

    delaySpy.mockRestore()
  })

  // GitHub generates tarballs and zipballs per request and publishes no size,
  // so a later request has no reason to produce the same bytes to splice onto.
  test('restarts a tarball rather than resuming it', async () => {
    const body = assetBody()
    const stub = stubAssetRequests([
      { status: 200, body: body.subarray(0, 10), aborted: true },
      { status: 200, body }
    ])
    const delaySpy = mockDelay()

    try {
      const result = await downloadFile({
        ...resumableAsset(),
        expectedSize: undefined,
        isTarBallOrZipBall: true
      })
      expect(fs.readFileSync(result)).toEqual(body)
      expect(stub.requests[1]['Range']).toBeUndefined()
    } finally {
      stub.restore()
      delaySpy.mockRestore()
    }
  })

  // Destroying the file stream while a write is still in flight makes it emit
  // its own error, which settled the download as a failed write to disk
  // rather than a cut-off it could resume.
  test('resumes when the stream fails with writes in flight', async () => {
    const body = Buffer.alloc(8 * 1024 * 1024, 'x')
    const stub = stubAssetRequests([
      { status: 200, body, abortedMidFlow: true },
      // Where the cut lands depends on the disk, so the resume is answered
      // with the whole asset, as a server that ignores the range would.
      { status: 200, body }
    ])
    const delaySpy = mockDelay()

    try {
      const result = await downloadFile({
        ...resumableAsset(),
        expectedSize: body.length
      })
      expect(fs.statSync(result).size).toBe(body.length)
      expect(stub.requests[1]['Range']).toMatch(/^bytes=\d+-$/)
    } finally {
      stub.restore()
      delaySpy.mockRestore()
    }
  })
})
