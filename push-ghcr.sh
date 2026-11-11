#!/bin/sh
set -eu

image=ghcr.io/jones14021/neugier:latest
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
docker build -t neugier:latest -t "$image" "$directory"
docker push "$image"