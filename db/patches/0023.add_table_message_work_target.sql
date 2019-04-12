CREATE TABLE `message_work_target` (
    `_id`         INT UNSIGNED NOT NULL auto_increment,
    `msgId`       VARCHAR( 191 ) NOT NULL,
    `source`      VARCHAR( 191 ) NOT NULL,
    `target`      VARCHAR( 191 ) NOT NULL,
    `memberId`    VARCHAR( 191 ) NULL,
    PRIMARY KEY( _id ),
    FOREIGN KEY( msgId ) REFERENCES message( msgId )
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY( memberId ) REFERENCES account( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;