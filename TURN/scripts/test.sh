#!/bin/sh

export LD_LIBRARY_PATH=${LD_LIBRARY_PATH}:../lib/
export DYLD_LIBRARY_PATH=${DYLD_LIBRARY_PATH}:../lib/
export user="hello-TURN-user"
export credential="hello-TURN-credential"
export host="friendos.com"

sh peer.sh &
sh client.sh