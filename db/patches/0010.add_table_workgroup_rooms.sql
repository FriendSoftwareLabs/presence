CREATE TABLE `workgroup_rooms` (
	`_id`         INT UNSIGNED NOT NULL auto_increment,
	`fId`         VARCHAR( 191 ) NOT NULL,
	`roomId`      VARCHAR( 191 ) NOT NULL,
	`setById`     VARCHAR( 191 ) NOT NULL,
	`setTime`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY( _id ),
	UNIQUE KEY( fId, roomId ),
	FOREIGN KEY( roomId ) REFERENCES room( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( setById ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
