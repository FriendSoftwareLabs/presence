ALTER TABLE message
ADD CONSTRAINT `fk_fromId` FOREIGN KEY ( fromId ) REFERENCES account( clientId )
    ON DELETE CASCADE
    ON UPDATE CASCADE;