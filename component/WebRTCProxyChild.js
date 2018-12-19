const log = require( './Log' )( 'WebRTCProxyChild' );
log( 'theres is no spoon, only fork' );
process.on( 'message', onMessage );
setInterval( ping, 5000 );

function onMessage( str ) {
	log( 'onMessage', str );
	process.send( str );
}

function ping() {
	log( 'ping' );
	process.send( 'ping' );
}
