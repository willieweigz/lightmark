# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

This policy applies to official Windows releases of LightMark (轻阅 Markdown) published from the [`willieweigz/lightmark`](https://github.com/willieweigz/lightmark) repository.

## Signed artifacts

After the project is accepted by SignPath Foundation, signing is limited to official LightMark Windows executables and installers that:

- are built from this public repository by the repository's GitHub Actions release workflow;
- correspond to a versioned release tag;
- contain only LightMark code and the open-source dependencies documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); and
- use matching LightMark product names and version metadata.

Every production signing request requires manual approval by the project approver. Test-signing policies, if enabled, are kept separate from production signing.

## Team roles

- Committer and reviewer: [Willie Wei (`@willieweigz`)](https://github.com/willieweigz)
- Approver: [Willie Wei (`@willieweigz`)](https://github.com/willieweigz)

Changes submitted by people who are not project committers must be reviewed before they are merged. Project members with repository or signing access must use multi-factor authentication.

## Privacy

LightMark is an offline Markdown reader and editor. It does not transfer user documents, document contents, usage data, or other user information to networked systems. Network access occurs only when the user explicitly opens an external link, or when the Windows installer must obtain the Microsoft WebView2 Runtime on a system where it is missing.

## System changes and removal

The Windows installer installs LightMark for the current user and registers LightMark as an available handler for `.md` and `.markdown` files. Windows remains responsible for the user's default-app choice. The installer includes an uninstaller that removes the application and its registrations.

Security concerns can be reported through the repository's [GitHub issue tracker](https://github.com/willieweigz/lightmark/issues).
