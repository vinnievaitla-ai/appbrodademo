#!/bin/bash
# Chrome wrapper for HyperFrames running inside a memory-constrained Docker container.
#
# Problem 1: HyperFrames calls os.totalmem() to decide Chrome's GPU memory budget, but
# os.totalmem() reads the HOST machine's RAM (e.g. 32 GB on Railway's bare metal), not
# the container's limit. This makes HyperFrames pass --force-gpu-mem-available-mb=16384
# to Chrome. SwiftShader (software GL) then tries to allocate 16 GB of texture buffers
# inside a container with ~512 MB → SIGKILL.
# Fix: clamp --force-gpu-mem-available-mb to 256 MB and add a V8 heap cap.
#
# Problem 2: Docker containers have only 64 MB of /dev/shm by default. Chrome uses
# shared memory for its compositing pipeline; after ~50 frames of 1080×1920 software
# rendering the budget exhausts and Chrome crashes (streaming encode fails mid-video).
# Fix: --disable-dev-shm-usage redirects Chrome to /tmp (much larger).
#
# HyperFrames sets PRODUCER_HEADLESS_SHELL_PATH to this script, so it is transparent.

ARGS=()
JS_FLAGS_SET=0
HAS_DISABLE_DEV_SHM=0

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
    --disable-dev-shm-usage)
      HAS_DISABLE_DEV_SHM=1
      ARGS+=("$arg")
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

# Redirect Chrome's shared-memory usage from /dev/shm (64 MB Docker default) to /tmp.
# Without this Chrome exhausts /dev/shm during frame capture and the render aborts.
if [ "$HAS_DISABLE_DEV_SHM" = "0" ]; then
  ARGS+=("--disable-dev-shm-usage")
fi

exec /usr/local/bin/chrome-headless-shell-real "${ARGS[@]}"
