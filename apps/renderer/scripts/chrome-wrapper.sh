#!/bin/bash
# Chrome wrapper for HyperFrames running inside a memory-constrained Docker container.
#
# Problem: HyperFrames calls os.totalmem() to decide Chrome's GPU memory budget, but
# os.totalmem() reads the HOST machine's RAM (e.g. 32 GB on Railway's bare metal), not
# the container's limit. This makes HyperFrames pass --force-gpu-mem-available-mb=16384
# to Chrome. SwiftShader (software GL) then tries to allocate 16 GB of texture buffers
# inside a container with ~512 MB → SIGKILL.
#
# Fix: intercept and clamp --force-gpu-mem-available-mb to 256 MB and add a V8 heap cap.
# HyperFrames wraps PRODUCER_HEADLESS_SHELL_PATH, so this script is transparent to it.

ARGS=()
JS_FLAGS_SET=0

for arg in "$@"; do
  case "$arg" in
    --force-gpu-mem-available-mb=*)
      ARGS+=("--force-gpu-mem-available-mb=256")
      ;;
    --js-flags=*)
      # Keep any other js-flags but cap old-space to 256 MB
      ARGS+=("--js-flags=--max-old-space-size=256")
      JS_FLAGS_SET=1
      ;;
    *)
      ARGS+=("$arg")
      ;;
  esac
done

# Ensure V8 heap cap is always set even when HyperFrames omits --js-flags
if [ "$JS_FLAGS_SET" = "0" ]; then
  ARGS+=("--js-flags=--max-old-space-size=256")
fi

exec /usr/local/bin/chrome-headless-shell-real "${ARGS[@]}"
