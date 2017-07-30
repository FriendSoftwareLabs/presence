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

const log = require( './Log' )( 'TCPPool' );
const TLSWatch = require( './TLSWatch' );
const Client = require( './Client' ).TCPClient;
const tls = require( 'tls' );
var ns = {}; // namespace

/*
// TCPPool
*/
ns.TCPPool = function( onClient ) {
	const self = this;
	self.onclient = onClient;
	self.tls = global.config.server.tls;
	self.port = global.config.server.tcp.port;
	
	self.pool = null;
	
	self.init();
}

// Public

ns.TCPPool.prototype.close = function() {
	const self = this;
	self.watch.close();
	self.closePool();
	delete self.onclient;
}

// Private

ns.TCPPool.prototype.init = function() {
	const self = this;
	var watchConf = {
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

ns.TCPPool.prototype.tlsUpdated = function( bundle ) {
	const self = this;
	self.tlsBundle = bundle;
	self.setupPool();
}

ns.TCPPool.prototype.setupPool = function() {
	const self = this;
	if ( self.pool )
		self.closePool();
	
	var opts = {
		key : self.tlsBundle.key,
		cert : self.tlsBundle.cert,
		rejectUnauthorized : false,
	};
	self.pool = tls.createServer( opts );
	self.pool.listen( self.port, listenReady );
	self.pool.on( 'secureConnection', onConnection );
	self.pool.on( 'error', poolErr );
	function listenReady() {
		var host = self.pool.address();
		log( 'pool nominal, listening on host: '
			+ host.address
			+ ' port:' + host.port
			+ ' ipv: ' + host.family );
	}
	
	function onConnection( client ) {
		self.handleConnection( client );
	}
	
	function poolErr( err ) {
		log( 'poolErr', err );
	}
}

ns.TCPPool.prototype.closePool = function() {
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

ns.TCPPool.prototype.handleConnection = function( socket ) {
	const self = this;
	log( 'handleConnection' );
	socket.setEncoding( 'utf8' );
	socket.setKeepAlive( true );
	const client = new Client( socket );
	self.onclient( client );
}

module.exports = ns.TCPPool;