ALTER TABLE "broker_credit_scores"
  DROP CONSTRAINT IF EXISTS "broker_credit_scores_broker_id_fkey",
  ADD CONSTRAINT "broker_credit_scores_broker_id_fkey"
    FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broker_credit_scores_grade_check') THEN
    ALTER TABLE "broker_credit_scores"
      ADD CONSTRAINT "broker_credit_scores_grade_check"
      CHECK ("grade" IN ('A', 'B', 'C', 'D', 'F'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broker_credit_scores_score_check') THEN
    ALTER TABLE "broker_credit_scores"
      ADD CONSTRAINT "broker_credit_scores_score_check"
      CHECK ("score" BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broker_credit_scores_payment_speed_check') THEN
    ALTER TABLE "broker_credit_scores"
      ADD CONSTRAINT "broker_credit_scores_payment_speed_check"
      CHECK ("payment_speed_score" BETWEEN 0 AND 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broker_credit_scores_payment_reliability_check') THEN
    ALTER TABLE "broker_credit_scores"
      ADD CONSTRAINT "broker_credit_scores_payment_reliability_check"
      CHECK ("payment_reliability_score" BETWEEN 0 AND 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broker_credit_scores_chargeback_check') THEN
    ALTER TABLE "broker_credit_scores"
      ADD CONSTRAINT "broker_credit_scores_chargeback_check"
      CHECK ("chargeback_score" BETWEEN 0 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broker_credit_scores_short_pay_check') THEN
    ALTER TABLE "broker_credit_scores"
      ADD CONSTRAINT "broker_credit_scores_short_pay_check"
      CHECK ("short_pay_score" BETWEEN 0 AND 10);
  END IF;
END $$;