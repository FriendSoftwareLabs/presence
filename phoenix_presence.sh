#!/bin/bash

timestamp() {
	date
}

if pgrep "presence.js" > /dev/null
then
	echo "Presence server is running"
else
	echo "Starting Hello server"
	until node presence.js; do
		echo "Presence server halted: " $( timestamp ) " - exitcode: $?. Respawning in 1 sec" >> restart.log
		sleep 1
	done >> error.log 2>&1
fi
