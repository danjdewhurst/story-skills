# VHS (https://github.com/charmbracelet/vhs) with Node, which its official
# image lacks, for rendering assets/demo.tape and
# assets/screenshot-continuity.tape. Both images are pinned by digest. Build
# it from the repo root, with no build context:
#   docker build -t story-skills-vhs - < assets/vhs.Dockerfile
# then run a tape as its header shows.

# node:22-bookworm-slim
FROM node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS node

# ghcr.io/charmbracelet/vhs v0.12.1
FROM ghcr.io/charmbracelet/vhs@sha256:ea49a6a1c529be83153e88321892b5585964418f0b9055e8c1e0d732194234a3
COPY --from=node /usr/local/bin/node /usr/local/bin/node
