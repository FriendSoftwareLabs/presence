'use strict';

/*©agpl*************************************************************************
*                                                                              *
* Friend Unifying Platform                                                     *
* ------------------------                                                     *
*                                                                              *
* Copyright 2014-2016 Friend Software Labs AS, all rights reserved.            *
* Hillevaagsveien 14, 4016 Stavanger, Norway                                   *
* Tel.: (+47) 40 72 96 56                                                      *
* Mail: info@friendos.com                                                      *
*                                                                              *
*****************************************************************************©*/

const log = require( './Log' )( 'WSPool' );
const TLSWatch = require( './TLSWatch' );
const Client = require( './Client' ).WSClient;
const WSS = require( 'ws' ).Server;
const https = require( 'https' );

const ns = {};
ns.WSPool = function( onClient ) {
	const self = this;
	self.onclient = onClient;
	self.tls = global.config.server.tls;
	self.port = global.config.server.ws.port;
	
	self.init();
}

// Public

ns.WSPool.prototype.close = function() {
	const self = this;
	self.watch.close();
	self.closePool();
	delete self.onclient;
}

// Private

ns.WSPool.prototype.init = function() {
	const self = this;
	const watchConf = {
		keyPath  : self.tls.keyPath,
		certPath : self.tls.certPath,
		onchange : onChange,
		onerr    : onErr,
	};
	self.watch = new TLSWatch( watchConf );
	function onChange( tlsBundle ) {
		self.tlsUpdated( tlsBundle );
		self.watch.acceptUpdate();
	}
	
	function onErr( err ) {
		log( 'tlsWatch err', err );
		self.close();
	}
}

ns.WSPool.prototype.tlsUpdated = function( bundle ) {
	const self = this;
	self.tlsBundle = bundle;
	self.setupPool();
}

ns.WSPool.prototype.setupPool = function() {
	const self = this;
	if ( self.pool )
		self.closePool();
	
	const httpsOptions = {
		key : self.tlsBundle.key,
		cert : self.tlsBundle.cert,
	};
	const port = self.port;
	const httpsServer = https.createServer( httpsOptions, fakeListen ).listen( port );
	self.pool = new WSS({ server : httpsServer });
	self.pool.on( 'error', error );
	self.pool.on( 'close', close );
	self.pool.on( 'connection', connection );
	
	function fakeListen() {}
	function error( e ) { log( 'pool error', e ); }
	function close( e ) { log( 'pool close', e ); }
	function connection( e ) { self.handleConnection( e ); }
}

ns.WSPool.prototype.closePool = function() {
	const self = this;
	log( 'closePool' );
	if ( !self.pool )
		return;
	
	const pool = self.pool;
	delete self.pool;
	pool.removeAllListeners();
	try {
		pool.close();
	} catch( e ) {}
}

ns.WSPool.prototype.handleConnection = function( socket ) {
	const self = this;
	const client = new Client( socket );
	self.onclient( client );
}

module.exports = ns.WSPool;
