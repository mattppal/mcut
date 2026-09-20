# Desktop signing and notarization

`desktop.yml` signs the macOS build with a Developer ID Application
certificate and notarizes it through the App Store Connect API when the
secrets below exist. Without them the build is signed ad hoc, so pull requests
and forks keep working. Only tag pushes and manual dispatches see the secrets.
Pull request runs never do.

`apps/desktop/electron-builder.ts` reads `CSC_LINK` once. Set, it signs with
the discovered Developer ID identity, hardened runtime, the entitlements in
`apps/desktop/build/entitlements.mac.plist`, and notarizes. Unset, it signs
ad hoc and skips notarization. `apps/desktop/scripts/verify-mac-signature.sh`
asserts the result for either mode.

## Secrets

Add these as repository secrets under Settings, Secrets and variables,
Actions.

| Secret | Value |
| --- | --- |
| `MAC_CERTIFICATE_P12` | The Developer ID Application certificate and private key as a base64 encoded `.p12` |
| `MAC_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12` |
| `APPLE_API_KEY_P8` | The full contents of the App Store Connect API key `.p8` file |
| `APPLE_API_KEY_ID` | The key ID shown next to the key, ten characters |
| `APPLE_API_ISSUER` | The issuer ID shown at the top of the Integrations page, a UUID |
| `APPLE_TEAM_ID` | The ten character team ID from the Apple Developer membership page |

The workflow maps them to the environment electron-builder reads.
`MAC_CERTIFICATE_P12` becomes `CSC_LINK`, `MAC_CERTIFICATE_PASSWORD` becomes
`CSC_KEY_PASSWORD`, and `APPLE_API_KEY_P8` is written to a file whose path
becomes `APPLE_API_KEY`. The other three keep their names.

## Export the certificate

1. In Xcode, open Settings, Accounts, select the team, Manage Certificates,
   and add a Developer ID Application certificate. The Apple Developer site
   under Certificates works as well.
2. Open Keychain Access, category My Certificates, find `Developer ID
   Application: <name> (<team id>)`, expand it so the private key shows, select
   both rows, and export as a `.p12` with a password.
3. Encode it and paste the output into `MAC_CERTIFICATE_P12`.

```sh
base64 -i DeveloperID.p12 | pbcopy
```

## Create the App Store Connect key

1. Open App Store Connect, Users and Access, Integrations, App Store Connect
   API, Team Keys.
2. Generate a key with the Developer role. Download the `.p8` once. Apple does
   not offer it again.
3. Copy the key ID into `APPLE_API_KEY_ID`, the issuer ID into
   `APPLE_API_ISSUER`, and the file contents into `APPLE_API_KEY_P8`.

```sh
cat AuthKey_<key id>.p8 | pbcopy
```

## Check a release

The mac job prints the `codesign` output and runs `spctl -a -vv -t exec` and
`xcrun stapler validate` on both apps. On a downloaded build the same three
commands confirm the signature, the notarization, and the stapled ticket.
