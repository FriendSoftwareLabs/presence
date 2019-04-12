CREATE TABLE `message_edit` (
    `_id`       INT UNSIGNED NOT NULL auto_increment,
    `clientId`  VARCHAR( 191 ) NOT NULL UNIQUE,
    `msgId`     VARCHAR( 191 ) NOT NULL,
    `editBy`    VARCHAR( 191 ),
    `editTime`  BIGINT NOT NULL,
    `reason`    TEXT,
    `message`   TEXT NOT NULL,
    PRIMARY KEY( _id ),
    FOREIGN KEY( msgId ) REFERENCES message( msgId )
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY( editBy ) REFERENCES account( clientId )
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;