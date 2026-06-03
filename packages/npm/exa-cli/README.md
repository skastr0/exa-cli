# Exa CLI

This package is the npm runner entrypoint for `exa-cli`.

It exposes the `exa-cli` command through a small Node launcher and delegates to the matching prebuilt Bun standalone binary package for the current platform.

```sh
npx @skastr0/exa-cli --version
bunx @skastr0/exa-cli --version
pnpm dlx @skastr0/exa-cli --version
```

The source repository and package documentation live at <https://github.com/skastr0/exa-cli>.
