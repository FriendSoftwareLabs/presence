#!/bin/bash
# This script enables debugging the node process.
# Using the debugger may crash the system. Debugger access
# may leak user data.
#
# IF UNSURE; DO NOT USE
#

timestamp() {
	date
}

if pgrep "presence.js" > /dev/null
then
	echo "Presence server is running"
else
	echo "Starting Hello server"
	until node --debug presence.js; do
		echo "Presence server halted: " $( timestamp ) " - exitcode: $?. Respawning in 1 sec" >> restart.log
		sleep 1
	done >> error.log 2>&1
fi
