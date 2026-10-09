interface GhAsset {
  name: string
  url: string
  size: number
}

export interface GithubRelease {
  name: string
  id: number
  tag_name: string
  prerelease: boolean
  assets: GhAsset[]
  tarball_url: string
  zipball_url: string
}

export interface DownloadMetaData {
  fileName: string
  url: string
  isTarBallOrZipBall: boolean
  /**
   * Byte count GitHub reports for the asset. Absent for tarballs and zipballs,
   * which GitHub generates on request and publishes no size for.
   */
  expectedSize?: number
}
