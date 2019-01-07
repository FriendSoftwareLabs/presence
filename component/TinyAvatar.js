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

const log = require( './Log' )( 'tinyAvatar' );
const crypto = require( 'crypto' );
const Jimp = require( 'jimp' );

const ns = {};
ns.TinyAvatar = function() {
	const self = this;
	self.init();
}

// Public

ns.TinyAvatar.prototype.generate = function( sourceString, type ) {
	const self = this;
	if ( !sourceString || !sourceString.length || 'string' !== typeof( sourceString )) {
		throw new Error( 'ERR_EMPTY_STRING' );
		return;
	}
	
	type = type || 'block';
	if ( 'block' === type )
		return self.generateBlock( sourceString );
	
	if ( 'roundel' === type )
		return self.generateRoundel( sourceString );
}

ns.TinyAvatar.prototype.generateGuest = function( type ) {
	const self = this;
	type = type || 'block';
	if ( 'block' === type )
		return self.generateGuestBlock();
	
	if ( 'roundel' === type )
		return self.generateGuestRoundel();
}

/*
ns.TinyAvatar.generateDefault = function( callback ) {
	const self = this;
	const color = Buffer.from( '', 'hex' );
	const bgColor = Buffer.from( '444444FF', 'hex' );
	const pattern = [
		0,1,1,1,0,
		1,0,0,0,1,
		0,0,1,1,0,
		0,0,0,0,0,
		0,0,1,0,0,
	];
}
*/

// Private

ns.TinyAvatar.prototype.init = function() {}

ns.TinyAvatar.prototype.generateBlock = function( string ) {
	const self = this;
	const source = self.getBuffer( string );
	const color = self.getColor( source.slice( 0, 4 ));
	const bgColor = self.getBgColor();
	const pattern = self.generateBlockPattern( source.slice( 4, 29 ));
	return self.buildBlock( color, bgColor, pattern );
}

ns.TinyAvatar.prototype.generateRoundel = function( string ) {
	const self = this;
	const source = self.getBuffer( string );
	const color = self.getColor( source.slice( 0, 4 ));
	const bgColor = self.getBgColor();
	const pattern = self.generateRoundelPattern( source.slice( 4, 21 ));
	return self.buildRoundel( color, bgColor, pattern );
}

ns.TinyAvatar.prototype.generateGuestBlock = function() {
	const self = this;
	const color = Buffer.from( '2B97CCFF', 'hex' );
	const bgColor = Buffer.from( '444444FF', 'hex' );
	// ?
	/*
	const pattern = [
		0,1,1,1,0,
		1,0,0,0,1,
		0,0,1,1,0,
		0,0,0,0,0,
		0,0,1,0,0,
	];
	*/
	
	// F
	const pattern = [
		1,1,1,1,1,
		1,0,0,0,0,
		1,1,1,1,0,
		1,0,0,0,0,
		1,0,0,0,0,
	];
	
	return self.buildBlock( color, bgColor, pattern );
}

ns.TinyAvatar.prototype.generateGuestRoundel = function() {
	const self = this;
	const color = Buffer.from( '2B97CCFF', 'hex' );
	const bgColor = Buffer.from( '444444FF', 'hex' );
	const pattern = [
		1, 0, 1, 0, 1,
		0, 1, 0,
		1,
		1, 0,
		0, 1, 0, 1, 0,
	];
	return self.buildRoundel( color, bgColor, pattern );
}

ns.TinyAvatar.prototype.buildBlock = function( color, bgColor, pattern ) {
	const self = this;
	const imageSide = 128;
	const border = 4;
	const pixelSize = ( imageSide - ( border * 2 )) / 5;
	const bitmask = self.buildBlockMask(
		imageSide,
		border,
		pixelSize,
		pattern,
		color,
		bgColor
	);
	
	return self.generateBase64( imageSide, bitmask );
}

ns.TinyAvatar.prototype.buildRoundel = function( color, bgColor, pattern ) {
	const self = this;
	const imageWidth = 128;
	const bitmask = self.buildRoundelMask(
		imageWidth,
		pattern,
		color,
		bgColor
	);
	
	return self.generateBase64( imageWidth, bitmask );
	
}

ns.TinyAvatar.prototype.generateBase64 = async function( sideLength, bitmask ) {
	const image = await new Jimp( sideLength, sideLength );
	image.bitmap.data = bitmask;
	return image.getBase64Async( Jimp.MIME_PNG );
}

ns.TinyAvatar.prototype.getBuffer = function( string ) {
	const self = this;
	const hash = crypto.createHash( 'sha256' );
	hash.update( string );
	const buffer = hash.digest( 'buffer' );
	return buffer;
}

ns.TinyAvatar.prototype.getColor = function( slice ) {
	const self = this;
	let cFloor = 85;
	let color1 = scale( slice[ 0 ], cFloor );
	let color2 = scale( slice[ 1 ], cFloor );
	let stdValues = [ color1, 255 ];
	let colorIndex = Math.floor( slice[ 2 ] / 256 * 3 ); // range 0-2
	let stdColorIndex = Math.floor( slice[ 3 ] / 256 * 2 ); // range 0-1
	let values = new Array( 4 ).fill( null );
	values[ colorIndex ] = color2;
	values.forEach( ( item, index ) => {
		if ( null != item )
			return;
		
		if ( 4 === index )
			return;
		
		let val = stdColorIndex ? stdValues.shift() : stdValues.pop();
		values[ index ] = val;
	});
	
	values[ 3 ] = 255; // alpha channel
	let colorBuff = Buffer.from( values );
	return colorBuff;
	
	function scale( cValue, cFloor ) {
		let v = cValue / 256;
		let scale = 256 - cFloor;
		let scaled = ( v * scale ) + cFloor;
		return scaled;
	}
}

ns.TinyAvatar.prototype.getBgColor = function() {
	const self = this;
	const bgColor = Buffer.from( '444444FF', 'hex' );
	return bgColor;
}

/*
the block pattern is 5x5, but is verticaly mirrored, so there are 15 total blocks
that need to be generated, 2 mirrord rows and a unique middle row.

x y o y x
x y o y x
x y o y x
x y o y x
x y o y x

blocks that are to be filled in will have the value 1, skipped blocks value 0

*/
ns.TinyAvatar.prototype.generateBlockPattern = function( source ) {
	const self = this;
	const max = 6;
	const min = 5;
	const maxTries = 7;
	let tries = 0;
	let limit = 127;
	let notSatisfied = true;
	let res = null;
	
	do {
		tries++;
		res = generate( limit, source );
		let filled = res.filled;
		if ( filled > max )
			limit = limit + 10;
		
		if ( filled < min )
			limit = limit - 10;
		
		if ( filled < max && filled > min )
			notSatisfied = false;
		
	} while ( notSatisfied && ( tries < maxTries ));
	
	//show( res.pattern );
	return res.pattern;
	
	function generate( limit, source ) {
		const rowLength = 5;
		const middleIndex = 2;
		const pattern = Array( 25 ).fill( 0 );
		let rows = 5;
		let filled = 0;
		pattern.forEach(( val, index ) => {
			let rowPos = index % rowLength;
			if ( rowPos > middleIndex ) {
				let stepBack = 4 - ( 4 - rowPos ) * 2;
				let mirrorPos = index - stepBack;
				pattern[ index ] = pattern[ mirrorPos ];
				return;
			}
			
			let sVal = source[ index ];
			let fill = 0;
			if ( limit <= sVal ) {
				filled++;
				fill = 1;
			}
			
			pattern[ index ] = fill;
		});
		
		return {
			pattern : pattern,
			filled  : filled };
	}
	
	function show( pattern ) {
		var str = '';
		pattern.forEach( ( p, i ) => {
			let pos = i % 5;
			if ( !pos )
				str += '\r\n';
			
			str += p;
		});
		
		console.log( str );
	}
}

ns.TinyAvatar.prototype.buildBlockMask = function(
	imageWidth,
	borderWidth,
	blockSize,
	blockPattern,
	blockColor,
	bgColor
) {
	const self = this;
	const pbd = 4; // pixel byte depth
	const realWidth = imageWidth * pbd;
	const realBlockWidth = blockSize * pbd;
	const borderTop = borderWidth * realWidth;
	const borderLeft = borderWidth * pbd;
	const bufferLength = imageWidth * imageWidth * pbd;
	const buf = Buffer.alloc( bufferLength );
	
	buf.fill( bgColor );
	
	/*
	log( 'build', {
		pw : imageWidth,
		rw : realWidth,
		bo : borderTop,
		bl : bufferLength,
	});
	*/
	
	// write in blocks
	blockPattern.forEach( ( block, index ) => {
		if ( !block )
			return;
		
		// both 0-indexed
		let col = index % 5;
		let row = Math.floor( index / 5 );
		
		// index offsets
		let startOffset = borderTop + ( realWidth * ( row * blockSize ));
		let rowOffset = borderLeft + ( col * realBlockWidth );
		let endOffset = realBlockWidth;
		
		/*
		log( 'block index', {
			i : index,
			r : row,
			c : col,
			so : startOffset,
			ro : rowOffset,
			eo : endOffset,
		});
		*/
		
		let currRow = 0;
		while ( currRow < blockSize ) {
			let blockOffset = currRow * realWidth;
			let start = startOffset + blockOffset + rowOffset;
			let end = start + endOffset;
			let slice = buf.slice( start, end );
			/*
			log( 'row', {
				r : currRow,
				s : start,
				e : end,
				slice : slice,
			});
			*/
			fill( slice, blockColor );
			currRow++;
		}
	});
	
	return buf;
	
	function fill( slice, color ) {
		let cl = color.length;
		for ( let index of slice.keys()) {
			let cI = index % cl;
			slice[ index ] = color[ cI ];
		}
	}
}

/*

the roundel pattern is, shockingly, round. It is built from a set of concentric rings
split into segments. There are three rings and a middle area.
the outer ring is 10 segments
the inner ring is 4 segments 
the center area is filled or not filled

for a total of 15 segments

the array references the layout as "vertical" slices, starting on the left, top to bottom
5 left segments of the outer shell
2 left segments of inner shell
center
2 right segments of inner shell
5 right segments of outer shell

o       o
o i   i o
o i c i o
o       o
o       o

to get the buffer layout:
	oooooiiciiooooo

*/

ns.TinyAvatar.prototype.generateRoundelPattern = function( source ) {
	const self = this;
	const max = 12;
	const min = 9;
	const maxTries = 5;
	let tries = 0;
	let limit = 127;
	let notSatisfied = true;
	let res = null;
	
	do {
		tries++;
		res = generate( limit, source );
		let filled = res.filled;
		if ( filled > max )
			limit = limit + 10;
		
		if ( filled < min )
			limit = limit - 10;
		
		if ( filled < max && filled > min )
			notSatisfied = false;
		
	} while ( notSatisfied && ( tries < maxTries ));
	
	return res.pattern;
	
	function generate( limit, source ) {
		let filled = 0;
		const pattern = Array( 25 ).fill( 0 );
		pattern.forEach(( val, index ) => {
			let sVal = source[ index ];
			let fill = 0;
			if ( limit <= sVal ) {
				filled++;
				fill = 1;
			}
			
			pattern[ index ] = fill;
		});
		
		return {
			pattern : pattern,
			filled  : filled };
	}
}

ns.TinyAvatar.prototype.buildRoundelMask = function(
	imageWidth,
	pattern,
	color,
	bgColor
) {
	const self = this;
	const borderWidth = 4;
	const pbd = 4; // pixel byte depth, aka one pixel is this many bytes in the buffer ( r, g, b, a )
	const realWidth = imageWidth * pbd;
	const lastPosition = imageWidth * imageWidth;
	const bufferLength = imageWidth * imageWidth * pbd;
	const buf = Buffer.alloc( bufferLength );
	
	buf.fill( bgColor );
	
	const xc = ( imageWidth / 2 ) -1;
	const yc = ( imageWidth / 2 ) -1;
	const r = ( imageWidth / 2 ) - borderWidth;
	const r2 = r * r;
	
	//
	
	const checkOuterRing = createOuterRingCheck( pattern );
	const checkMiddleRing = createMiddleRingCheck( pattern );
	const innerCheck = createInnerRingCheck( pattern );
	
	//
	let ya = 0;
	let xa = 0;
	while ( ya < imageWidth ) {
		xa = 0;
		while( xa < imageWidth ) {
			let x = xa - xc;
			let y = yc - ya;
			let fill = checkFill( x, y );
			if ( fill )
				fillPosition( xa, ya );
			
			++xa;
		}
		
		++ya;
	}
	
	return buf;
	
	function checkFill( x, y ) {
		let dist = Math.hypot( x, y );
		let angle = Math.atan2( y, x );
		let hPI = Math.PI * ( 1 / 2 );
		let tq2PI = 2 * Math.PI * ( 3 / 4 );
		
		angle = angle + tq2PI;
		if ( angle > ( 2 * Math.PI ))
			angle = angle - 2 * Math.PI;
		
		if ( angle === ( 2 * Math.PI ))
			angle = 0;
		
		if( checkOuterRing( dist, angle )) {
			return true;
		}
		
		if( checkMiddleRing( dist, angle )) {
			return true;
		}
		
		if ( innerCheck( dist, angle ))
			return true;
				
		return false;
	}
	
	function fillPosition( x, y ) {
		let position = x + ( imageWidth * y );
		const start = position * pbd;
		const end = start + pbd;
		const slice = buf.slice( start, end );
		/*
		log( 'fillPosition', {
			pos : position,
			slice : slice,
			color : color,
		});
		*/
		
		slice.fill( color );
		/*
		let i = 0;
		while( i < slice.length ) {
			slice[ i ] = color[ i ];
			++i;
		}
		*/
	}
	
	function createOuterRingCheck( pattern ) {
		const l = pattern.slice( 0, 5 );
		const r = pattern.slice( 11, 16 );
		const check = [ ...l, ...r ];
		const ringCheck = createRingCheck( 60, 40 );
		const segmentCheck = createSegmentCheck( check );
		
		return ( dist, angle ) => {
			if ( !ringCheck( dist ))
				return false;
			
			if ( !segmentCheck( angle ))
				return false;
			
			return true;
			
			/*
			let segRad = ( 2 * Math.PI ) / segments;
			let segIndex = Math.floor( angle / segRad );
			let v = check[ segIndex ];
			log( 'segIndex', {
				a : angle,
				i : segIndex,
				v : v,
			});
			return !!v;
			*/
		}
	}
	
	function createMiddleRingCheck( pattern ) {
		const l = pattern.slice( 5, 8 );
		const r = pattern.slice( 9, 11 );
		const check = [ ...l, ...r ];
		const ringCheck = createRingCheck( 36, 18 );
		const segmentCheck = createSegmentCheck( check );
		
		return ( dist, angle ) => {
			if ( !ringCheck( dist ))
				return false;
			
			if ( !segmentCheck( angle ))
				return false;
			
			return true;
		}
	}
	
	function createInnerRingCheck( pattern ) {
		const check = pattern.slice( 8, 9 );
		const ringCheck = createRingCheck( 14, 0 );
		const segmentCheck = createSegmentCheck( check );
		
		return ( dist, angle ) => {
			if ( !ringCheck( dist ))
				return false;
			
			if ( !segmentCheck( angle ))
				return false;
			
			return true;
		}
	}
	
	function createRingCheck( outer, inner ) {
		return function( d ) {
			if ( d > outer )
				return false;
			
			if ( d < inner )
				return false;
			
			return true;
		}
	}
	
	function createSegmentCheck( values ) {
		const segments = values.length;
		const segRads = ( Math.PI * 2 ) / segments;
		return function( angle ) {
			let index = Math.floor( angle / segRads );
			let value = values[ index ];
			
			return !!value;
		}
	}
}

module.exports = new ns.TinyAvatar();
