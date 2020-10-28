ALTER TABLE invite_token
ADD CONSTRAINT `fk_targetId` FOREIGN KEY ( targetId ) REFERENCES account( clientId )
    ON DELETE CASCADE
    ON UPDATE CASCADE;