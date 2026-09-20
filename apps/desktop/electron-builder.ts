import type { Configuration } from 'electron-builder'

type MacSigning = 'developer-id' | 'ad-hoc'

const signing: MacSigning = (process.env.CSC_LINK ?? '') === '' ? 'ad-hoc' : 'developer-id'

const config: Configuration = {
  appId: 'com.mcut.studio',
  productName: 'mcut Studio',
  artifactName: 'mcut-studio-${version}-${os}-${arch}.${ext}',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  asar: true,
  files: ['dist/**', 'studio/**', 'package.json', 'THIRD_PARTY_NOTICES.md'],
  npmRebuild: false,
  publish: { provider: 'github', owner: 'mattppal', repo: 'mcut' },
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    grantFileProtocolExtraPrivileges: false,
    enableNodeCliInspectArguments: true,
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    category: 'public.app-category.video',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    ...(signing === 'ad-hoc' ? { identity: '-' } : {}),
    notarize: signing === 'developer-id',
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    executableName: 'mcut-studio',
    category: 'AudioVideo',
  },
}

export default config
