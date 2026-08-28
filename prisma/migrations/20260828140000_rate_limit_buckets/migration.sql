-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "id" TEXT NOT NULL,
    "bucket_key" TEXT NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "hit_count" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_buckets_bucket_key_key" ON "rate_limit_buckets"("bucket_key");
