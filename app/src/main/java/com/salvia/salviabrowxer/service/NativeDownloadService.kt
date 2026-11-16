package com.salvia.salviabrowxer.service

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.salvia.salviabrowxer.MainActivity
import com.salvia.salviabrowxer.R
import com.salvia.salviabrowxer.SalviaApplication
import com.salvia.salviabrowxer.core.NativeProxyClient
import com.salvia.salviabrowxer.core.RangeChunkPlanner
import com.salvia.salviabrowxer.media.DashManifestParser
import com.salvia.salviabrowxer.media.DashSegmentPlan
import com.salvia.salviabrowxer.media.HlsKeyParser
import com.salvia.salviabrowxer.media.NativeMediaMuxer
import com.salvia.salviabrowxer.storage.MediaPublisher
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

object NativeDownloadBus {
    @Volatile
    var listener: ((JSONObject) -> Unit)? = null

    fun emit(payload: JSONObject) {
        listener?.invoke(payload)
    }
}

class NativeDownloadService : Service() {

    private data class JobState(
        val id: String,
        val filename: String,
        val paused: AtomicBoolean = AtomicBoolean(false),
        val cancelled: AtomicBoolean = AtomicBoolean(false),
        val activeCalls: MutableList<okhttp3.Call> = java.util.Collections.synchronizedList(mutableListOf())
    )

    private val jobs = ConcurrentHashMap<String, JobState>()
    private val pool = Executors.newFixedThreadPool(12)
    private val notifId = 4101

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val id = intent.getStringExtra(EXTRA_ID) ?: return START_NOT_STICKY
                val url = intent.getStringExtra(EXTRA_URL) ?: return START_NOT_STICKY
                val filename = intent.getStringExtra(EXTRA_FILENAME) ?: "media.mp4"
                val mimeType = intent.getStringExtra(EXTRA_MIME) ?: "video/mp4"
                val isHls = intent.getBooleanExtra(EXTRA_IS_HLS, false)
                val connections = intent.getIntExtra(EXTRA_CONNECTIONS, 4).coerceIn(1, 8)
                val autoSave = intent.getBooleanExtra(EXTRA_AUTO_SAVE, true)
                val audioTrackUrl = intent.getStringExtra(EXTRA_AUDIO_TRACK_URL)?.takeIf { it.isNotBlank() }
                val referer = intent.getStringExtra(EXTRA_REFERER)?.takeIf { it.isNotBlank() }

                val job = JobState(id = id, filename = filename)
                jobs[id] = job
                promoteForeground(filename, 0)

                pool.execute {
                    runDownload(job, url, mimeType, isHls, connections, autoSave, audioTrackUrl, referer)
                }
            }
            ACTION_PAUSE -> {
                val id = intent.getStringExtra(EXTRA_ID) ?: return START_NOT_STICKY
                jobs[id]?.let { job ->
                    job.paused.set(true)
                    synchronized(job.activeCalls) {
                        job.activeCalls.forEach { it.cancel() }
                    }
                }
            }
            ACTION_CANCEL -> {
                val id = intent.getStringExtra(EXTRA_ID) ?: return START_NOT_STICKY
                jobs[id]?.let { job ->
                    job.cancelled.set(true)
                    synchronized(job.activeCalls) {
                        job.activeCalls.forEach { it.cancel() }
                    }
                }
            }
        }
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        jobs.values.forEach { job ->
            job.paused.set(true)
            synchronized(job.activeCalls) {
                job.activeCalls.forEach { it.cancel() }
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        jobs.values.forEach { job ->
            job.cancelled.set(true)
            synchronized(job.activeCalls) {
                job.activeCalls.forEach { it.cancel() }
            }
        }
        pool.shutdownNow()
        super.onDestroy()
    }

    private fun cleanHttpUrl(rawUrl: String): String {
        val hashIdx = rawUrl.indexOf('#')
        return if (hashIdx >= 0) rawUrl.substring(0, hashIdx) else rawUrl
    }

    private fun isDashSource(url: String, mimeType: String): Boolean {
        val clean = cleanHttpUrl(url).lowercase()
        val mimeLow = mimeType.lowercase()
        return mimeLow.contains("dash+xml") ||
            clean.contains(".mpd?") ||
            clean.endsWith(".mpd")
    }

    private fun newRequestBuilder(url: String, referer: String?): Request.Builder {
        val builder = Request.Builder()
            .url(cleanHttpUrl(url))
            .header("User-Agent", USER_AGENT)
        if (!referer.isNullOrBlank()) {
            builder.header("Referer", referer)
            try {
                val rUri = java.net.URI(referer)
                val portPart = if (rUri.port > 0) ":${rUri.port}" else ""
                if (!rUri.scheme.isNullOrBlank() && !rUri.host.isNullOrBlank()) {
                    builder.header("Origin", "${rUri.scheme}://${rUri.host}$portPart")
                }
            } catch (_: Exception) {
            }
        }
        return builder
    }

    private fun runDownload(
        job: JobState,
        url: String,
        mimeType: String,
        isHls: Boolean,
        connections: Int,
        autoSave: Boolean,
        audioTrackUrl: String?,
        referer: String?
    ) {
        val downloadsDir = File(filesDir, "downloads").apply { mkdirs() }
        val safeStorageId = job.id.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val ext = job.filename.substringAfterLast('.', "").takeIf { it.length in 1..5 } ?: "mp4"
        val fileKey = "$safeStorageId.$ext"
        val outFile = File(downloadsDir, fileKey)
        val partsDir = File(downloadsDir, "parts_$safeStorageId")
        val startedAt = System.currentTimeMillis()
        var lastReportAt = 0L
        var lastNotifAt = 0L

        fun reportProgress(downloaded: Long, total: Long?, force: Boolean = false) {
            val now = System.currentTimeMillis()
            if (!force && now - lastReportAt < 250L) return
            lastReportAt = now
            val elapsedSec = maxOf(0.1, (now - startedAt) / 1000.0)
            val speed = (downloaded / elapsedSec).toLong()
            val eta = if (total != null && total > downloaded && speed > 0L) {
                ((total - downloaded) + speed - 1L) / speed
            } else {
                null
            }
            val pct = if (total != null && total > 0L) {
                ((downloaded * 100L) / total).toInt().coerceIn(0, 100)
            } else {
                -1
            }
            if (force || now - lastNotifAt >= 800L) {
                lastNotifAt = now
                updateNotification(job.filename, pct)
            }
            NativeDownloadBus.emit(
                JSONObject()
                    .put("type", "progress")
                    .put("id", job.id)
                    .put("downloadedBytes", downloaded)
                    .put("totalBytes", total ?: JSONObject.NULL)
                    .put("bytesPerSecond", speed)
                    .put("etaSeconds", eta ?: JSONObject.NULL)
            )
        }

        try {
            val isDash = !isHls && isDashSource(url, mimeType)
            val outMime = if (isHls) {
                downloadHls(job, url, audioTrackUrl, outFile, referer) { dl, est -> reportProgress(dl, est) }
                "video/mp4"
            } else if (isDash) {
                downloadDash(job, url, outFile, referer) { dl, est -> reportProgress(dl, est) }
                "video/mp4"
            } else if (!audioTrackUrl.isNullOrBlank()) {
                val muxDir = File(cacheDir, "mux_$safeStorageId").apply { mkdirs() }
                try {
                    val videoTmp = File(muxDir, "video.bin")
                    val audioTmp = File(muxDir, "audio.bin")
                    downloadDirect(job, url, videoTmp, partsDir, connections, referer) { dl, total -> reportProgress(dl, total) }
                    if (!job.paused.get() && !job.cancelled.get()) {
                        when {
                            audioTrackUrl.contains(".m3u8", ignoreCase = true) ->
                                downloadHlsRaw(job, audioTrackUrl, audioTmp, muxDir, referer)
                            isDashSource(audioTrackUrl, "") ->
                                downloadDashTrackOnly(job, audioTrackUrl, audioTmp, muxDir, referer, preferAudio = true)
                            else ->
                                downloadSingleStream(job, audioTrackUrl, audioTmp, referer)
                        }
                    }
                    if (!job.paused.get() && !job.cancelled.get()) {
                        val muxed = NativeMediaMuxer.muxVideoAndAudio(videoTmp, audioTmp, outFile)
                        if (!muxed && videoTmp.exists()) {
                            videoTmp.copyTo(outFile, overwrite = true)
                        }
                    }
                    "video/mp4"
                } finally {
                    muxDir.deleteRecursively()
                }
            } else {
                downloadDirect(job, url, outFile, partsDir, connections, referer) { dl, total -> reportProgress(dl, total) }
            }

            if (job.paused.get()) {
                NativeDownloadBus.emit(JSONObject().put("type", "paused").put("id", job.id))
                return
            }
            if (job.cancelled.get()) {
                outFile.delete()
                partsDir.deleteRecursively()
                NativeDownloadBus.emit(JSONObject().put("type", "cancelled").put("id", job.id))
                return
            }

            partsDir.deleteRecursively()
            val finalSize = outFile.length()
            reportProgress(finalSize, finalSize, force = true)
            val publishedUri = if (autoSave) {
                MediaPublisher.publishToDevice(this, outFile, job.filename, outMime)
            } else {
                null
            }
            val localPlaybackUrl = "https://appassets.androidplatform.net/api/local-file?id=$fileKey&mime=${
                java.net.URLEncoder.encode(outMime, "UTF-8")
            }"

            NativeDownloadBus.emit(
                JSONObject()
                    .put("type", "complete")
                    .put("id", job.id)
                    .put("blobUrl", localPlaybackUrl)
                    .put("finalSize", finalSize)
                    .put("mimeType", outMime)
                    .put("nativeUri", publishedUri ?: MediaPublisher.providerUriForInternalFile(this, outFile).toString())
            )
        } catch (e: Exception) {
            when {
                job.paused.get() -> NativeDownloadBus.emit(JSONObject().put("type", "paused").put("id", job.id))
                job.cancelled.get() -> {
                    outFile.delete()
                    partsDir.deleteRecursively()
                    NativeDownloadBus.emit(JSONObject().put("type", "cancelled").put("id", job.id))
                }
                else -> {
                    NativeDownloadBus.emit(
                        JSONObject()
                            .put("type", "error")
                            .put("id", job.id)
                            .put("message", e.message ?: "Download failed")
                    )
                }
            }
        } finally {
            jobs.remove(job.id)
            if (jobs.isEmpty()) {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    private fun downloadDirect(
        job: JobState,
        url: String,
        outFile: File,
        partsDir: File,
        connections: Int,
        referer: String?,
        onProgress: (Long, Long?) -> Unit
    ): String {
        val headCall = NativeProxyClient.httpClient.newCall(
            newRequestBuilder(url, referer).head().build()
        )
        job.activeCalls.add(headCall)
        var totalLength: Long? = null
        var acceptRanges = false
        var detectedMime = "video/mp4"
        try {
            headCall.execute().use { res ->
                if (res.isSuccessful) {
                    totalLength = res.header("Content-Length")?.toLongOrNull()?.takeIf { it > 0L }
                    acceptRanges = res.header("Accept-Ranges").equals("bytes", ignoreCase = true)
                    detectedMime = res.header("Content-Type")?.substringBefore(';')?.trim() ?: detectedMime
                }
            }
        } catch (_: Exception) {
            // Try tiny Range probe below
        } finally {
            job.activeCalls.remove(headCall)
        }

        if (!job.paused.get() && !job.cancelled.get() && (!acceptRanges || totalLength == null)) {
            val probeCall = NativeProxyClient.httpClient.newCall(
                newRequestBuilder(url, referer)
                    .get()
                    .header("Range", "bytes=0-0")
                    .build()
            )
            job.activeCalls.add(probeCall)
            try {
                probeCall.execute().use { res ->
                    if (res.code == 206) {
                        acceptRanges = true
                        val cr = res.header("Content-Range").orEmpty()
                        if (cr.contains("/")) {
                            cr.substringAfter("/").toLongOrNull()?.takeIf { it > 0L }?.let { totalLength = it }
                        }
                        detectedMime = res.header("Content-Type")?.substringBefore(';')?.trim() ?: detectedMime
                    }
                }
            } catch (_: Exception) {
                // Fall through to single-stream GET
            } finally {
                job.activeCalls.remove(probeCall)
            }
        }

        if (job.paused.get() || job.cancelled.get()) return detectedMime

        val total = totalLength
        if (acceptRanges && total != null && total >= 262_144L && connections > 1) {
            val ranges = RangeChunkPlanner.computeRanges(total, connections)
            partsDir.mkdirs()

            val initialDownloaded = ranges.sumOf { range ->
                val partFile = File(partsDir, "chunk_${range.index}.part")
                val expectedLen = range.end - range.start + 1L
                if (partFile.exists()) partFile.length().coerceAtMost(expectedLen) else 0L
            }
            val downloaded = AtomicLong(initialDownloaded)
            val failure = AtomicReference<Throwable?>(null)
            val latch = CountDownLatch(ranges.size)

            for (range in ranges) {
                pool.execute {
                    val partFile = File(partsDir, "chunk_${range.index}.part")
                    val expectedLen = range.end - range.start + 1L
                    val existing = if (partFile.exists()) partFile.length().coerceAtMost(expectedLen) else 0L
                    if (existing >= expectedLen) {
                        latch.countDown()
                        return@execute
                    }
                    val resumeStart = range.start + existing
                    val call = NativeProxyClient.httpClient.newCall(
                        newRequestBuilder(url, referer)
                            .header("Range", "bytes=$resumeStart-${range.end}")
                            .build()
                    )
                    job.activeCalls.add(call)
                    try {
                        call.execute().use { res ->
                            if (!res.isSuccessful) throw IllegalStateException("HTTP ${res.code}")
                            if (res.code != 206) {
                                throw IllegalStateException("Range unsupported (HTTP ${res.code})")
                            }
                            val input = res.body?.byteStream() ?: throw IllegalStateException("Empty body")
                            FileOutputStream(partFile, existing > 0L).use { out ->
                                val buf = ByteArray(32 * 1024)
                                while (!job.paused.get() && !job.cancelled.get() && failure.get() == null) {
                                    val n = input.read(buf)
                                    if (n < 0) break
                                    out.write(buf, 0, n)
                                    val totalNow = downloaded.addAndGet(n.toLong())
                                    onProgress(totalNow, total)
                                }
                            }
                        }
                    } catch (t: Throwable) {
                        failure.compareAndSet(null, t)
                    } finally {
                        job.activeCalls.remove(call)
                        latch.countDown()
                    }
                }
            }
            latch.await()
            val chunkErr = failure.get()
            if (job.paused.get() || job.cancelled.get()) return detectedMime
            if (chunkErr == null) {
                outFile.outputStream().use { finalOut ->
                    for (range in ranges) {
                        val partFile = File(partsDir, "chunk_${range.index}.part")
                        partFile.inputStream().use { it.copyTo(finalOut, 64 * 1024) }
                        partFile.delete()
                    }
                }
                return detectedMime
            }
            // Server rejected or broke concurrent range chunks — fall back cleanly to single-stream GET
            partsDir.deleteRecursively()
        }

        // Single-stream with byte-offset resume support when Accept-Ranges is available
        partsDir.mkdirs()
        val partFile = File(partsDir, "single.part")
        var attemptOffset = if (acceptRanges && partFile.exists()) partFile.length() else 0L
        var completedCleanly = false

        for (attempt in 0..1) {
            if (completedCleanly || job.paused.get() || job.cancelled.get()) break
            val reqBuilder = newRequestBuilder(url, referer)
            if (attemptOffset > 0L) {
                reqBuilder.header("Range", "bytes=$attemptOffset-")
            }
            val getCall = NativeProxyClient.httpClient.newCall(reqBuilder.build())
            job.activeCalls.add(getCall)
            try {
                getCall.execute().use { res ->
                    if (res.code == 416 && attemptOffset > 0L && attempt == 0) {
                        partFile.delete()
                        attemptOffset = 0L
                        return@use
                    }
                    if (!res.isSuccessful) throw IllegalStateException("HTTP ${res.code}")
                    val isAppending = attemptOffset > 0L && res.code == 206
                    detectedMime = res.header("Content-Type")?.substringBefore(';')?.trim() ?: detectedMime
                    val remainingLen = res.header("Content-Length")?.toLongOrNull()?.takeIf { it > 0L }
                    val effectiveTotal = totalLength ?: remainingLen?.let { if (isAppending) attemptOffset + it else it }
                    val input = res.body?.byteStream() ?: throw IllegalStateException("Empty body")
                    var dl = if (isAppending) attemptOffset else 0L
                    FileOutputStream(partFile, isAppending).use { out ->
                        val buf = ByteArray(32 * 1024)
                        while (!job.paused.get() && !job.cancelled.get()) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            dl += n
                            onProgress(dl, effectiveTotal)
                        }
                    }
                    completedCleanly = true
                }
            } finally {
                job.activeCalls.remove(getCall)
            }
        }

        if (!job.paused.get() && !job.cancelled.get() && partFile.exists() && completedCleanly) {
            if (outFile.exists()) outFile.delete()
            if (!partFile.renameTo(outFile)) {
                partFile.copyTo(outFile, overwrite = true)
                partFile.delete()
            }
        }
        return detectedMime
    }

    /**
     * Downloads DASH (.mpd) manifests with SegmentTemplate / SegmentTimeline / SegmentList / BaseURL,
     * streams video & audio segments in bounded batches (minimal RAM & temp disk), and muxes to MP4.
     */
    private fun downloadDash(
        job: JobState,
        mpdUrl: String,
        outFile: File,
        referer: String?,
        onProgress: (Long, Long?) -> Unit
    ) {
        val desiredRepId = mpdUrl.substringAfter("#salvia_rep=", "").takeIf { it.isNotBlank() }
        val manifestText = fetchText(job, cleanHttpUrl(mpdUrl), referer)
        val parsed = DashManifestParser.parse(manifestText, mpdUrl)
        if (parsed.isDrmProtected) {
            throw IllegalStateException("DRM-protected DASH stream cannot be downloaded")
        }
        if (parsed.isDynamicLive) {
            throw IllegalStateException("Live DASH streams are not supported")
        }

        val videoTrack = (desiredRepId?.let { id -> parsed.videoTracks.firstOrNull { it.id == id } }
            ?: parsed.videoTracks.firstOrNull())
        val audioTrack = parsed.audioTracks.firstOrNull()

        if (videoTrack == null && audioTrack == null) {
            throw IllegalStateException("No downloadable DASH tracks found")
        }

        val tempDir = File(cacheDir, "dash_${job.id.replace(Regex("[^a-zA-Z0-9._-]"), "_")}").apply { mkdirs() }
        try {
            val totalDownloaded = AtomicLong(0L)
            if (videoTrack != null) {
                val videoFile = File(tempDir, "video_dash.bin")
                downloadDashPlan(job, videoTrack.plan, videoFile, tempDir, "v", referer) { segBytes, totalSegs, doneSegs ->
                    val dl = totalDownloaded.addAndGet(segBytes)
                    val estTotal = if (doneSegs > 0) ((dl.toDouble() / doneSegs) * totalSegs).toLong() else null
                    onProgress(dl, estTotal)
                }
                if (job.paused.get() || job.cancelled.get()) return

                if (audioTrack != null) {
                    val audioFile = File(tempDir, "audio_dash.bin")
                    downloadDashPlan(job, audioTrack.plan, audioFile, tempDir, "a", referer) { segBytes, _, _ ->
                        totalDownloaded.addAndGet(segBytes)
                    }
                    if (job.paused.get() || job.cancelled.get()) return

                    val muxed = NativeMediaMuxer.muxVideoAndAudio(videoFile, audioFile, outFile)
                    if (!muxed) {
                        val remuxed = NativeMediaMuxer.remuxToMp4(videoFile, outFile)
                        if (!remuxed) videoFile.copyTo(outFile, overwrite = true)
                    }
                    audioFile.delete()
                } else {
                    val remuxed = NativeMediaMuxer.remuxToMp4(videoFile, outFile)
                    if (!remuxed) {
                        videoFile.copyTo(outFile, overwrite = true)
                    }
                }
                videoFile.delete()
            } else if (audioTrack != null) {
                val audioFile = File(tempDir, "audio_dash.bin")
                downloadDashPlan(job, audioTrack.plan, audioFile, tempDir, "a", referer) { segBytes, totalSegs, doneSegs ->
                    val dl = totalDownloaded.addAndGet(segBytes)
                    val estTotal = if (doneSegs > 0) ((dl.toDouble() / doneSegs) * totalSegs).toLong() else null
                    onProgress(dl, estTotal)
                }
                if (job.paused.get() || job.cancelled.get()) return
                val remuxed = NativeMediaMuxer.remuxToMp4(audioFile, outFile)
                if (!remuxed) {
                    audioFile.copyTo(outFile, overwrite = true)
                }
                audioFile.delete()
            }
        } finally {
            tempDir.deleteRecursively()
        }
    }

    private fun downloadDashTrackOnly(
        job: JobState,
        mpdUrl: String,
        outFile: File,
        tempDir: File,
        referer: String?,
        preferAudio: Boolean
    ) {
        val manifestText = fetchText(job, cleanHttpUrl(mpdUrl), referer)
        val parsed = DashManifestParser.parse(manifestText, mpdUrl)
        val track = if (preferAudio) {
            parsed.audioTracks.firstOrNull() ?: parsed.videoTracks.firstOrNull()
        } else {
            parsed.videoTracks.firstOrNull() ?: parsed.audioTracks.firstOrNull()
        } ?: return
        downloadDashPlan(job, track.plan, outFile, tempDir, if (preferAudio) "a" else "v", referer) { _, _, _ -> }
    }

    private fun downloadDashPlan(
        job: JobState,
        plan: DashSegmentPlan,
        outFile: File,
        tempDir: File,
        prefix: String,
        referer: String?,
        onSegmentDelta: (Long, Int, Int) -> Unit
    ) {
        val allUrls = buildList {
            plan.initUrl?.let { add(it) }
            addAll(plan.segmentUrls)
        }
        if (allUrls.isEmpty()) throw IllegalStateException("Empty DASH segment plan")

        val totalCount = allUrls.size
        val completedCount = AtomicInteger(0)
        val batchSize = 12

        FileOutputStream(outFile, false).use { mergedOut ->
            var offset = 0
            while (offset < totalCount && !job.paused.get() && !job.cancelled.get()) {
                val end = minOf(offset + batchSize, totalCount)
                val countInBatch = end - offset
                val batchFiles = Array<File?>(countInBatch) { null }
                val failure = AtomicReference<Throwable?>(null)
                val nextLocal = AtomicInteger(0)
                val workers = minOf(4, countInBatch)
                val latch = CountDownLatch(workers)

                repeat(workers) {
                    pool.execute {
                        try {
                            val buf = ByteArray(32 * 1024)
                            while (!job.paused.get() && !job.cancelled.get() && failure.get() == null) {
                                val localIdx = nextLocal.getAndIncrement()
                                if (localIdx >= countInBatch) break
                                val globalIdx = offset + localIdx
                                val segUrl = allUrls[globalIdx]
                                val segFile = File(tempDir, "${prefix}_dash_$globalIdx.seg")
                                val call = NativeProxyClient.httpClient.newCall(
                                    newRequestBuilder(segUrl, referer).build()
                                )
                                job.activeCalls.add(call)
                                var writtenBytes = 0L
                                try {
                                    call.execute().use { res ->
                                        if (!res.isSuccessful) throw IllegalStateException("DASH segment HTTP ${res.code}")
                                        val input = res.body?.byteStream() ?: throw IllegalStateException("Empty DASH segment")
                                        segFile.outputStream().use { segOut ->
                                            while (!job.paused.get() && !job.cancelled.get()) {
                                                val n = input.read(buf)
                                                if (n < 0) break
                                                segOut.write(buf, 0, n)
                                                writtenBytes += n
                                            }
                                        }
                                    }
                                } finally {
                                    job.activeCalls.remove(call)
                                }
                                batchFiles[localIdx] = segFile
                                val doneNow = completedCount.incrementAndGet()
                                onSegmentDelta(writtenBytes, totalCount, doneNow)
                            }
                        } catch (t: Throwable) {
                            failure.compareAndSet(null, t)
                        } finally {
                            latch.countDown()
                        }
                    }
                }
                latch.await()
                failure.get()?.let { throw it }
                if (job.paused.get() || job.cancelled.get()) return

                for (i in 0 until countInBatch) {
                    val segFile = batchFiles[i] ?: continue
                    segFile.inputStream().use { it.copyTo(mergedOut, 32 * 1024) }
                    segFile.delete()
                    batchFiles[i] = null
                }
                offset = end
            }
        }
    }

    private fun downloadHls(
        job: JobState,
        playlistUrl: String,
        audioTrackUrl: String?,
        outFile: File,
        referer: String?,
        onProgress: (Long, Long?) -> Unit
    ) {
        var effectiveUrl = playlistUrl
        var manifestText = fetchText(job, effectiveUrl, referer)
        for (hop in 0 until 2) {
            val nextVariant = RangeChunkPlanner.selectBestMasterVariantUrl(manifestText, effectiveUrl) ?: break
            effectiveUrl = nextVariant
            manifestText = fetchText(job, effectiveUrl, referer)
        }

        val entries = HlsKeyParser.parsePlaylistEntries(manifestText, effectiveUrl)
        if (entries.isEmpty()) throw IllegalStateException("Empty playlist")

        val keyCache = ConcurrentHashMap<String, ByteArray>()
        val tempDir = File(cacheDir, "hls_${job.id.replace(Regex("[^a-zA-Z0-9._-]"), "_")}").apply { mkdirs() }

        try {
            val rawMergedTs = File(tempDir, "merged_video.ts")
            val completedSegments = AtomicInteger(0)
            val downloaded = AtomicLong(0L)
            val batchSize = 16

            // Rolling bounded batches keep mobile RAM and temp disk usage minimal even on long HD videos
            FileOutputStream(rawMergedTs, false).use { mergedOut ->
                var offset = 0
                while (offset < entries.size && !job.paused.get() && !job.cancelled.get()) {
                    val end = minOf(offset + batchSize, entries.size)
                    val batchCount = end - offset
                    val segFiles = Array<File?>(batchCount) { null }
                    val nextLocal = AtomicInteger(0)
                    val failure = AtomicReference<Throwable?>(null)
                    val workers = minOf(4, batchCount)
                    val latch = CountDownLatch(workers)

                    repeat(workers) {
                        pool.execute {
                            try {
                                while (!job.paused.get() && !job.cancelled.get() && failure.get() == null) {
                                    val localIdx = nextLocal.getAndIncrement()
                                    if (localIdx >= batchCount) break
                                    val globalIdx = offset + localIdx
                                    val entry = entries[globalIdx]
                                    val segReqBuilder = newRequestBuilder(entry.url, referer)
                                    if (entry.byteRangeOffset != null && entry.byteRangeLength != null && entry.byteRangeLength > 0L) {
                                        val endByte = entry.byteRangeOffset + entry.byteRangeLength - 1L
                                        segReqBuilder.header("Range", "bytes=${entry.byteRangeOffset}-$endByte")
                                    }
                                    val segCall = NativeProxyClient.httpClient.newCall(segReqBuilder.build())
                                    job.activeCalls.add(segCall)
                                    val rawBytes = try {
                                        segCall.execute().use { res ->
                                            if (!res.isSuccessful) throw IllegalStateException("Segment HTTP ${res.code}")
                                            res.body?.bytes() ?: throw IllegalStateException("Empty segment")
                                        }
                                    } finally {
                                        job.activeCalls.remove(segCall)
                                    }

                                    val finalBytes = if (entry.keySpec != null && entry.keySpec.method == "AES-128") {
                                        val keyUri = entry.keySpec.keyUri
                                            ?: throw IllegalStateException("Missing AES-128 key URI")
                                        val keyBytes = keyCache.getOrPut(keyUri) { fetchKeyBytes(job, keyUri, referer) }
                                        val iv = entry.keySpec.explicitIv ?: HlsKeyParser.sequenceIv(entry.sequenceNumber)
                                        HlsKeyParser.decryptAes128Cbc(rawBytes, keyBytes, iv)
                                    } else {
                                        rawBytes
                                    }

                                    val segFile = File(tempDir, "seg_$globalIdx.ts")
                                    segFile.writeBytes(finalBytes)
                                    segFiles[localIdx] = segFile

                                    val nowDl = downloaded.addAndGet(finalBytes.size.toLong())
                                    val doneCount = completedSegments.incrementAndGet()
                                    val estTotal = ((nowDl.toDouble() / doneCount) * entries.size).toLong()
                                    onProgress(nowDl, estTotal)
                                }
                            } catch (t: Throwable) {
                                failure.compareAndSet(null, t)
                            } finally {
                                latch.countDown()
                            }
                        }
                    }
                    latch.await()
                    failure.get()?.let { throw it }

                    if (job.paused.get() || job.cancelled.get()) return

                    for (i in 0 until batchCount) {
                        val seg = segFiles[i] ?: continue
                        seg.inputStream().use { it.copyTo(mergedOut, 32 * 1024) }
                        seg.delete()
                        segFiles[i] = null
                    }
                    offset = end
                }
            }

            if (job.paused.get() || job.cancelled.get()) return

            if (!audioTrackUrl.isNullOrBlank()) {
                val audioFile = File(tempDir, "audio_track.bin")
                if (audioTrackUrl.contains(".m3u8", ignoreCase = true)) {
                    downloadHlsRaw(job, audioTrackUrl, audioFile, tempDir, referer)
                } else {
                    downloadSingleStream(job, audioTrackUrl, audioFile, referer)
                }
                if (!job.paused.get() && !job.cancelled.get()) {
                    val muxed = NativeMediaMuxer.muxVideoAndAudio(rawMergedTs, audioFile, outFile)
                    if (!muxed) {
                        val remuxed = NativeMediaMuxer.remuxToMp4(rawMergedTs, outFile)
                        if (!remuxed) rawMergedTs.copyTo(outFile, overwrite = true)
                    }
                }
                audioFile.delete()
            } else {
                val remuxed = NativeMediaMuxer.remuxToMp4(rawMergedTs, outFile)
                if (!remuxed) {
                    rawMergedTs.copyTo(outFile, overwrite = true)
                }
            }
            rawMergedTs.delete()
        } finally {
            tempDir.deleteRecursively()
        }
    }

    private fun downloadHlsRaw(job: JobState, playlistUrl: String, outFile: File, tempDir: File, referer: String?) {
        val text = fetchText(job, playlistUrl, referer)
        val entries = HlsKeyParser.parsePlaylistEntries(text, playlistUrl)
        if (entries.isEmpty()) return
        val keyCache = HashMap<String, ByteArray>()
        outFile.outputStream().use { out ->
            for (entry in entries) {
                if (job.paused.get() || job.cancelled.get()) break
                val reqBuilder = newRequestBuilder(entry.url, referer)
                if (entry.byteRangeOffset != null && entry.byteRangeLength != null && entry.byteRangeLength > 0L) {
                    val endByte = entry.byteRangeOffset + entry.byteRangeLength - 1L
                    reqBuilder.header("Range", "bytes=${entry.byteRangeOffset}-$endByte")
                }
                val call = NativeProxyClient.httpClient.newCall(reqBuilder.build())
                job.activeCalls.add(call)
                val raw = try {
                    call.execute().use { res ->
                        if (!res.isSuccessful) throw IllegalStateException("Audio segment HTTP ${res.code}")
                        res.body?.bytes() ?: ByteArray(0)
                    }
                } finally {
                    job.activeCalls.remove(call)
                }
                val bytes = if (entry.keySpec != null && entry.keySpec.method == "AES-128") {
                    val uri = entry.keySpec.keyUri ?: throw IllegalStateException("Missing audio key URI")
                    val key = keyCache.getOrPut(uri) { fetchKeyBytes(job, uri, referer) }
                    val iv = entry.keySpec.explicitIv ?: HlsKeyParser.sequenceIv(entry.sequenceNumber)
                    HlsKeyParser.decryptAes128Cbc(raw, key, iv)
                } else {
                    raw
                }
                val f = File(tempDir, "a_${entry.sequenceNumber}.ts")
                f.writeBytes(bytes)
                out.write(bytes)
                f.delete()
            }
        }
    }

    private fun downloadSingleStream(job: JobState, url: String, outFile: File, referer: String?) {
        val call = NativeProxyClient.httpClient.newCall(
            newRequestBuilder(url, referer).build()
        )
        job.activeCalls.add(call)
        try {
            call.execute().use { res ->
                if (!res.isSuccessful) throw IllegalStateException("Audio HTTP ${res.code}")
                val input = res.body?.byteStream() ?: throw IllegalStateException("Empty audio stream")
                outFile.outputStream().use { out ->
                    val buf = ByteArray(32 * 1024)
                    while (!job.paused.get() && !job.cancelled.get()) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                    }
                }
            }
        } finally {
            job.activeCalls.remove(call)
        }
    }

    private fun fetchText(job: JobState, url: String, referer: String?): String {
        val call = NativeProxyClient.httpClient.newCall(
            newRequestBuilder(url, referer).build()
        )
        job.activeCalls.add(call)
        return try {
            call.execute().use { res ->
                if (!res.isSuccessful) throw IllegalStateException("HTTP ${res.code}")
                res.body?.string().orEmpty()
            }
        } finally {
            job.activeCalls.remove(call)
        }
    }

    private fun fetchKeyBytes(job: JobState, keyUrl: String, referer: String?): ByteArray {
        val call = NativeProxyClient.httpClient.newCall(
            newRequestBuilder(keyUrl, referer).build()
        )
        job.activeCalls.add(call)
        return try {
            call.execute().use { res ->
                if (!res.isSuccessful) throw IllegalStateException("Key HTTP ${res.code}")
                res.body?.bytes() ?: throw IllegalStateException("Empty encryption key")
            }
        } finally {
            job.activeCalls.remove(call)
        }
    }

    private fun promoteForeground(filename: String, progressPct: Int) {
        val notif = buildNotification(filename, progressPct)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(notifId, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(notifId, notif)
        }
    }

    @SuppressLint("MissingPermission")
    private fun updateNotification(filename: String, progressPct: Int) {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.notify(notifId, buildNotification(filename, progressPct))
    }

    private fun buildNotification(filename: String, progressPct: Int): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, SalviaApplication.CHANNEL_DOWNLOADS)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(filename)
            .setContentText(if (progressPct >= 0) "$progressPct%" else getString(R.string.app_name))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, progressPct.coerceIn(0, 100), progressPct < 0)
            .setContentIntent(openIntent)
            .build()
    }

    companion object {
        private const val USER_AGENT =
            "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"

        const val ACTION_START = "com.salvia.salviabrowxer.action.START"
        const val ACTION_PAUSE = "com.salvia.salviabrowxer.action.PAUSE"
        const val ACTION_CANCEL = "com.salvia.salviabrowxer.action.CANCEL"

        const val EXTRA_ID = "id"
        const val EXTRA_URL = "url"
        const val EXTRA_FILENAME = "filename"
        const val EXTRA_MIME = "mime"
        const val EXTRA_IS_HLS = "is_hls"
        const val EXTRA_CONNECTIONS = "connections"
        const val EXTRA_AUTO_SAVE = "auto_save"
        const val EXTRA_AUDIO_TRACK_URL = "audio_track_url"
        const val EXTRA_REFERER = "referer"

        fun start(
            context: Context,
            id: String,
            url: String,
            filename: String,
            mimeType: String,
            isHls: Boolean,
            connections: Int,
            autoSave: Boolean,
            audioTrackUrl: String? = null,
            referer: String? = null
        ) {
            val intent = Intent(context, NativeDownloadService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_ID, id)
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_FILENAME, filename)
                putExtra(EXTRA_MIME, mimeType)
                putExtra(EXTRA_IS_HLS, isHls)
                putExtra(EXTRA_CONNECTIONS, connections)
                putExtra(EXTRA_AUTO_SAVE, autoSave)
                if (!audioTrackUrl.isNullOrBlank()) {
                    putExtra(EXTRA_AUDIO_TRACK_URL, audioTrackUrl)
                }
                if (!referer.isNullOrBlank()) {
                    putExtra(EXTRA_REFERER, referer)
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun pause(context: Context, id: String) {
            context.startService(
                Intent(context, NativeDownloadService::class.java).apply {
                    action = ACTION_PAUSE
                    putExtra(EXTRA_ID, id)
                }
            )
        }

        fun cancel(context: Context, id: String) {
            context.startService(
                Intent(context, NativeDownloadService::class.java).apply {
                    action = ACTION_CANCEL
                    putExtra(EXTRA_ID, id)
                }
            )
        }
    }
}
