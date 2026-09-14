-- Fix a real bug found via live-database testing: the Stage 1 append-only
-- trigger on audit_log unconditionally blocked ALL updates, including the
-- FK `ON DELETE SET NULL` cascade that fires when a referenced user
-- (audit_log.actor_id -> users.id) is deleted. That made it impossible to
-- ever delete a user who had any audit history.
--
-- This narrows the trigger to allow exactly that one legitimate case —
-- actor_id transitioning to NULL with every other column unchanged — while
-- continuing to reject every other UPDATE, and still rejecting all DELETEs
-- unconditionally.
CREATE OR REPLACE FUNCTION "audit_log_prevent_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id = OLD.id
           AND NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
           AND NEW.action = OLD.action
           AND NEW.entity = OLD.entity
           AND NEW.entity_id = OLD.entity_id
           AND NEW.metadata = OLD.metadata
           AND NEW.created_at = OLD.created_at
        THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
