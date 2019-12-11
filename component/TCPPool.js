'use strict';

/*©agpl*************************************************************************
*                                                                              *
* This file is part of FRIEND UNIFYING PLATFORM.                               *
*                                                                              *
* This program is free software: you can redistribute it and/or modify         *
* it under the terms of the GNU Affero General Public License as published by  *
* the Free Software Foundation, either version 3 of the License, or            *
* (at your option) any later version.                                          *
*                                                                              *
* This program is distributed in the hope that it will be useful,              *
* but WITHOUT ANY WARRANTY; without even the implied warranty of               *
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the                 *
* GNU Affero General Public License for more details.                          *
*                                                                              *
* You should have received a copy of the GNU Affero General Public License     *
* along with this program.  If not, see <http://www.gnu.org/licenses/>.        *
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
	socket.setEncoding( 'utf8' );
	socket.setKeepAlive( true );
	const client = new Client( socket );
	self.onclient( client );
}

module.exports = ns.TCPPool;