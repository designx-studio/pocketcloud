# Contributing to PocketCloud

Thank you for your interest in contributing to PocketCloud!

## Code of Conduct

Be respectful. Constructive feedback welcome. No harassment.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork: `git clone https://github.com/<your-username>/pocketcloud.git`
3. Follow the [Developer Guide](./developer-guide.md) to set up your local environment
4. Create a feature branch: `git checkout -b feat/your-feature-name`

## Pull Request Process

1. **Open an issue first** for significant features — discuss approach before coding
2. **Write tests** — PRs without test coverage for new code paths will be asked to add them
3. **Run CI locally** before submitting:
   ```bash
   npm run build
   npm test
   npm run lint -w @pocketcloud/api
   ```
4. **Keep PRs focused** — one feature or fix per PR
5. **Update docs** — update the relevant file in `docs/` if you change behavior
6. **Describe changes** clearly in the PR description

## What to Contribute

### Good First Issues

- Improving error messages in the frontend
- Adding more AI diagnostic rules in `POST /api/v1/diagnostics/ai`
- Additional blueprint compatibility checks
- More agent task types (idempotent ones only)

### Architecture Discussions

Open a GitHub Discussion before proposing:
- New database models
- New authentication methods
- WebSocket-based real-time instead of polling
- Multi-tenancy / team accounts

## Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): add PATCH /api/v1/servers/:id endpoint
fix(agent): handle /proc/stat read error on container hosts
docs(blueprint): document service field schema
chore(ci): add trivy security scan step
```

## Testing

All new API endpoints must have:
- A happy-path test
- An auth-required test (401 without token)
- A validation test (400 with bad input)

All new agent task handlers must:
- Handle command timeout gracefully
- Return appropriate exit codes to `completeTask`
- Log meaningful messages to `sendTaskLog`

## Release Process

Releases are managed by the core maintainers via GitHub Actions:
- `main` branch: continuous deployment to staging
- Tags (`v1.2.0`): production release, agent binary build, Docker image push

## License

PocketCloud is MIT licensed. By contributing, you agree to license your work under the same terms.
