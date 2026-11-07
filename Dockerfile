# Adiutor's production image: one image with the whole application, which runs the app by default
# and also its jobs and scripts as one-off commands (`docker run … pnpm jobs:run`). It has every
# dependency, development ones included, because the scripts run through tsx and migrations through
# drizzle-kit. The database isn't part of it: you provide PostgreSQL, and the image never migrates
# on its own. See "Docker" in docs/deploying.md and docs/decisions/.
#
# The base image follows a tag that keeps moving (Node.js 26 LTS on Debian 13), pinned to a digest:
# each week Renovate moves the digest to the latest build, bringing in Node.js patches and Debian
# security fixes. A tag for one exact version stops being rebuilt once a newer one is out.

# Node.js 26 LTS (.nvmrc names the oldest 26 the app supports), with pnpm at the version
# package.json names ("packageManager"). Node.js no longer ships Corepack, so npm installs pnpm.
FROM node:26-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS base
# No git hooks to install, and no telemetry from Next.js.
ENV HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json ./
# Installed for every user, so `pnpm` works as the unprivileged user below without downloading.
# npm only runs the install scripts of packages it's told to allow; pnpm's set it up.
RUN npm install --global --allow-scripts=pnpm "$(node -p "require('./package.json').packageManager")"

# The dependencies, exactly as the lockfile has them. A layer of its own, so changing the source
# doesn't reinstall them.
FROM base AS dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# The production build. Building needs the configuration to pass validation, but connects to
# nothing, so these are placeholders, not secrets; the real values come with `docker run`.
FROM dependencies AS build
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-only-placeholder-not-a-secret-0123456789 \
    BETTER_AUTH_URL=http://localhost:3000 \
    pnpm build

# The image: the built app, its source, scripts and migrations, run as the unprivileged `node` user.
FROM base AS app
ENV NODE_ENV=production
# npm only installed pnpm (which stays); without it, the image doesn't carry npm's own packages.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
# Healthy when the database answers and every migration is applied (src/app/api/health/route.ts).
# Node's own fetch, since the slim image has no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`).then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]
CMD ["pnpm", "start"]
