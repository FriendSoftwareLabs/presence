CREATE TABLE `message` (
	`_id`       INT UNSIGNED NOT NULL auto_increment,
	`msgId`     VARCHAR( 191 ) NOT NULL UNIQUE,
	`roomId`    VARCHAR( 191 ) NOT NULL,
	`accountId` VARCHAR( 191 ) NOT NULL,
	`timestamp` BIGINT NOT NULL,
	`type`      VARCHAR( 20 ) NOT NULL DEFAULT 'msg',
	`message`   TEXT NOT NULL,
	PRIMARY KEY( _id ),
	FOREIGN KEY( roomId ) REFERENCES room( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( accountId ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4;