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
