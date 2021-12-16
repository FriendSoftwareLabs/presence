CREATE TABLE `message_status` (
	`_id`       INT UNSIGNED NOT NULL auto_increment,
	`clientId`  VARCHAR( 191 ) NOT NULL UNIQUE,
	`msgId`     VARCHAR( 191 ) NOT NULL,
	`setBy`     VARCHAR( 191 ),
	`setTime`   BIGINT NOT NULL,
	`status`    VARCHAR( 191 ),
	`reason`    TEXT,
	`message`   TEXT,
	PRIMARY KEY( _id ),
	CONSTRAINT FK_status_message 
		FOREIGN KEY( msgId ) REFERENCES message( msgId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	CONSTRAINT FK_status_account 
		FOREIGN KEY( setBy ) REFERENCES account( clientId )
		ON DELETE SET NULL
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;