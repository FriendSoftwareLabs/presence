#!/bin/sh

export LD_LIBRARY_PATH=${LD_LIBRARY_PATH}:../lib/
export DYLD_LIBRARY_PATH=${DYLD_LIBRARY_PATH}:../lib/

echo $@
../bin/turnutils_peer