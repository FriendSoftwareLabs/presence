#!/bin/bash

timestamp() {
	date
}

if pgrep "TURN" > /dev/null
then
	echo "TURN server is running"
else
	echo "Starting TURN server"
	until bin/turnserver >> TURN.log; do
		echo "TURN server halted: " $( timestamp ) " - exitcode: $?. Respawning in 1 sec" >> TURN_restart.log
		sleep 1
	done
fi
