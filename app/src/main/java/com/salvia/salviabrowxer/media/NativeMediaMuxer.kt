package com.salvia.salviabrowxer.media

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

object NativeMediaMuxer {
    private const val BUFFER_SIZE = 512 * 1024

    fun remuxToMp4(inputFile: File, outputMp4: File): Boolean {
        if (!inputFile.exists() || inputFile.length() == 0L) return false
        val extractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        try {
            extractor.setDataSource(inputFile.absolutePath)
            val trackCount = extractor.trackCount
            if (trackCount <= 0) return false

            muxer = MediaMuxer(outputMp4.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val indexMap = HashMap<Int, Int>()
            for (i in 0 until trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("video/") || mime.startsWith("audio/")) {
                    extractor.selectTrack(i)
                    indexMap[i] = muxer.addTrack(format)
                }
            }
            if (indexMap.isEmpty()) return false

            muxer.start()
            copySelectedTracks(extractor, muxer, indexMap)
            muxer.stop()
            return outputMp4.exists() && outputMp4.length() > 0L
        } catch (_: Exception) {
            outputMp4.delete()
            return false
        } finally {
            try {
                muxer?.release()
            } catch (_: Exception) {
            }
            try {
                extractor.release()
            } catch (_: Exception) {
            }
        }
    }

    fun muxVideoAndAudio(videoFile: File, audioFile: File, outputMp4: File): Boolean {
        if (!videoFile.exists() || videoFile.length() == 0L) return false
        if (!audioFile.exists() || audioFile.length() == 0L) {
            return remuxToMp4(videoFile, outputMp4)
        }

        val videoExtractor = MediaExtractor()
        val audioExtractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        try {
            videoExtractor.setDataSource(videoFile.absolutePath)
            audioExtractor.setDataSource(audioFile.absolutePath)

            muxer = MediaMuxer(outputMp4.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

            val videoMap = HashMap<Int, Int>()
            for (i in 0 until videoExtractor.trackCount) {
                val format = videoExtractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("video/")) {
                    videoExtractor.selectTrack(i)
                    videoMap[i] = muxer.addTrack(format)
                    break
                }
            }

            val audioMap = HashMap<Int, Int>()
            for (i in 0 until audioExtractor.trackCount) {
                val format = audioExtractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("audio/")) {
                    audioExtractor.selectTrack(i)
                    audioMap[i] = muxer.addTrack(format)
                    break
                }
            }

            if (videoMap.isEmpty() && audioMap.isEmpty()) return false

            muxer.start()
            if (videoMap.isNotEmpty()) {
                copySelectedTracks(videoExtractor, muxer, videoMap)
            }
            if (audioMap.isNotEmpty()) {
                copySelectedTracks(audioExtractor, muxer, audioMap)
            }
            muxer.stop()
            return outputMp4.exists() && outputMp4.length() > 0L
        } catch (_: Exception) {
            outputMp4.delete()
            return false
        } finally {
            try {
                muxer?.release()
            } catch (_: Exception) {
            }
            try {
                videoExtractor.release()
            } catch (_: Exception) {
            }
            try {
                audioExtractor.release()
            } catch (_: Exception) {
            }
        }
    }

    private fun copySelectedTracks(
        extractor: MediaExtractor,
        muxer: MediaMuxer,
        trackIndexMap: Map<Int, Int>
    ) {
        val buffer = ByteBuffer.allocate(BUFFER_SIZE)
        val info = MediaCodec.BufferInfo()
        val lastPtsByTrack = HashMap<Int, Long>()

        while (true) {
            val sampleTrack = extractor.sampleTrackIndex
            if (sampleTrack < 0) break
            val destTrack = trackIndexMap[sampleTrack]
            if (destTrack == null) {
                extractor.advance()
                continue
            }

            val sampleSize = extractor.readSampleData(buffer, 0)
            if (sampleSize < 0) break

            var pts = extractor.sampleTime
            val prevPts = lastPtsByTrack[destTrack]
            if (prevPts != null && pts < prevPts) {
                pts = prevPts + 1L
            }
            lastPtsByTrack[destTrack] = pts

            info.offset = 0
            info.size = sampleSize
            info.presentationTimeUs = maxOf(0L, pts)
            val sFlags = extractor.sampleFlags
            info.flags = if ((sFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) {
                MediaCodec.BUFFER_FLAG_KEY_FRAME
            } else {
                0
            }
            muxer.writeSampleData(destTrack, buffer, info)
            extractor.advance()
        }
    }
}
