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

const log = require( './Log' )( 'tinyAvatar' );
const crypto = require( 'crypto' );
const Jimp = require( 'jimp' );

const ns = {};
ns.TinyAvatar = function() {
	const self = this;
	self.init();
}

// Public

ns.TinyAvatar.prototype.generate = function( string, callback ) {
	const self = this;
	if ( !string ) {
		callback( 'ERR_EMPTY_STRING', null );
		return;
	}
	
	const source = self.getBuffer( string );
	const color = self.getColor( source.slice( 0, 4 ));
	const bgColor = Buffer( '444444FF', 'hex' );
	const pattern = self.generateBlockPattern( source.slice( 4, 29 ));
	
	const side = 128;
	const border = 4;
	const block = ( 128 - ( border * 2 )) / 5;
	const imageBuff = self.buildImageBuffer(
		side,
		border,
		block,
		pattern,
		color,
		bgColor
	);
	
	new Jimp( side, side, ( err, image ) => {
		image.bitmap.data = imageBuff;
		image.getBase64( Jimp.MIME_PNG, ( err, res ) => {
			callback( err, res );
		});
	});
}

// Private

ns.TinyAvatar.prototype.init = function() {}

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
	let color1 = slice[ 0 ] > cFloor ? slice[ 0 ] : cFloor;
	let color2 = slice[ 1 ] > cFloor ? slice[ 1 ] : cFloor;
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
	let colorBuff = new Buffer( values );
	return colorBuff;
}

/*
the block pattern is 5x5, but is verticaly mirrored, so there are 15 total blocks
that need to be generated, 2 mirrord rows and a unique middle row.

x x o x x
x x o x x
x x o x x
x x o x x
x x o x x

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

ns.TinyAvatar.prototype.buildImageBuffer = function(
	pixelWidth,
	borderWidth,
	blockWidth,
	blockPattern,
	blockColor,
	bgColor
) {
	const self = this;
	const pbd = 4; // pixel byte depth
	const realWidth = pixelWidth * pbd;
	const realBlockWidth = blockWidth * pbd;
	const borderTop = borderWidth * realWidth;
	const borderLeft = borderWidth * pbd;
	const bufferLength = pixelWidth * pixelWidth * pbd;
	const buf = Buffer( bufferLength );
	
	// fill with bg color
	for ( let index of buf.keys()) {
		let pI = index % pbd; // pixel index
		buf[ index ] = bgColor[ pI ];
	}
	
	/*
	log( 'build', {
		pw : pixelWidth,
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
		let startOffset = borderTop + ( realWidth * ( row * blockWidth ));
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
		while ( currRow < blockWidth ) {
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


module.exports = new ns.TinyAvatar();
