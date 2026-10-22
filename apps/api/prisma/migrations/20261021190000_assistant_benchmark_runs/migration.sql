-- CreateTable
CREATE TABLE "assistant_benchmark_runs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "commit" TEXT,
    "label" TEXT,
    "total" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "auto_saved_wrong" INTEGER NOT NULL,
    "regressions" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL,
    "ms" INTEGER NOT NULL,
    "cases" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_benchmark_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_benchmark_runs_created_at_idx" ON "assistant_benchmark_runs"("created_at");
