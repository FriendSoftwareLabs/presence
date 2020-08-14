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

var log = require( './Log')( 'Config' );

var exampleConfObj = require( '../example.config.js' );
var confObj = require('../config.js');

var ns = {};

(function( ns, undefined ) {
	ns.Config = function() {
		const self = this;
		self.init();
	}
	
	ns.Config.prototype.init = function() {
		const self = this;
		var config = self.setMissing( confObj, exampleConfObj );
		self.server = config.server;
		self.shared = config.shared;
		self.shared.wsHost = self.getWsHost();
		global.config = self;
	}
	
	ns.Config.prototype.get = function() {
		const self = this;
		var conf = {
			server : self.server,
			shared : self.shared,
		};
		return global.config;
	}
	
	ns.Config.prototype.getWsHost = function() {
		const self = this;
		const domain = self.server.domain;
		const port = self.server.ws.port;
		const proxy = self.server.ws.proxy;
		let host = null;
		if ( null != proxy )
			host = domain + proxy;
		else
			host = domain + ':' + port;
		
		return host;
	}
	
	// static
	ns.Config.prototype.setMissing = function( dest, src ) {
		return sync( dest, src );
		
		function sync( dest, src ) {
			if ( undefined === dest )
				return src;
			
			if (( src == null ) || ( typeof( src ) !== 'object' ))
				return dest;
			
			const srcKeys = Object.keys( src );
			if ( srcKeys.length )
				srcKeys.forEach( goDeeper );
			
			return dest;
			
			function goDeeper( key ) {
				const deeperDest = dest[ key ];
				const deeperSrc = src[ key ];
				dest[ key ] = sync( deeperDest, deeperSrc );
			}
		}
	}
	
})( ns );

module.exports = new ns.Config();
