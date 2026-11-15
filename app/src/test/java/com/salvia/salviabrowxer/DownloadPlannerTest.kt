package com.salvia.salviabrowxer

import com.salvia.salviabrowxer.core.AdBlockHostRules
import com.salvia.salviabrowxer.core.LinkPatternCategory
import com.salvia.salviabrowxer.core.LinkPatternDetector
import com.salvia.salviabrowxer.core.PlatformExtractorKey
import com.salvia.salviabrowxer.core.RangeChunkPlanner
import com.salvia.salviabrowxer.media.HlsKeyParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadPlannerTest {

    @Test
    fun computeRangesSplitsLargeFilesContiguously() {
        val total = 1_000_000L
        val ranges = RangeChunkPlanner.computeRanges(total, 4)
        assertEquals(4, ranges.size)
        assertEquals(0L, ranges.first().start)
        assertEquals(total - 1L, ranges.last().end)
        for (i in 1 until ranges.size) {
            assertEquals(ranges[i - 1].end + 1L, ranges[i].start)
        }
    }

    @Test
    fun computeRangesUsesSingleChunkForSmallFiles() {
        val ranges = RangeChunkPlanner.computeRanges(128_000L, 4)
        assertEquals(1, ranges.size)
        assertEquals(0L, ranges[0].start)
        assertEquals(127_999L, ranges[0].end)
    }

    @Test
    fun extractHlsSegmentUrlsResolvesRelativePaths() {
        val manifest = """
            #EXTM3U
            #EXT-X-TARGETDURATION:10
            #EXTINF:10.0,
            seg1.ts
            #EXTINF:10.0,
            /chunks/seg2.ts
            #EXT-X-ENDLIST
        """.trimIndent()
        val urls = RangeChunkPlanner.extractHlsSegmentUrls(manifest, "https://cdn.example.com/live/index.m3u8")
        assertEquals(
            listOf(
                "https://cdn.example.com/live/seg1.ts",
                "https://cdn.example.com/chunks/seg2.ts"
            ),
            urls
        )
    }

    @Test
    fun adBlockHostRulesMatchesTrackerSubdomains() {
        assertTrue(AdBlockHostRules.isBlockedUrl("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"))
        assertFalse(AdBlockHostRules.isBlockedUrl("https://cdn.example.com/video/movie.mp4"))
    }

    @Test
    fun selectBestMasterVariantUrlPicksHighestBandwidth() {
        val master = """
            #EXTM3U
            #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
            low/prog.m3u8
            #EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080
            high/prog.m3u8
        """.trimIndent()
        assertEquals(
            "https://cdn.example.com/vod/high/prog.m3u8",
            RangeChunkPlanner.selectBestMasterVariantUrl(master, "https://cdn.example.com/vod/master.m3u8")
        )
    }

    @Test
    fun hlsKeyParserHandlesAes128AndSequenceIv() {
        val playlist = """
            #EXTM3U
            #EXT-X-MEDIA-SEQUENCE:10
            #EXT-X-KEY:METHOD=AES-128,URI="keys/key1.bin"
            seg10.ts
            seg11.ts
        """.trimIndent()
        val entries = HlsKeyParser.parsePlaylistEntries(playlist, "https://cdn.example.com/hls/list.m3u8")
        assertEquals(2, entries.size)
        assertEquals("AES-128", entries[0].keySpec?.method)
        assertEquals("https://cdn.example.com/hls/keys/key1.bin", entries[0].keySpec?.keyUri)
        assertEquals(10L, entries[0].sequenceNumber)
        assertEquals(11L, entries[1].sequenceNumber)
        val iv10 = HlsKeyParser.sequenceIv(10L)
        assertEquals(10.toByte(), iv10[15])
    }

    @Test
    fun hlsKeyParserTracksByteRangesForCmafStreams() {
        val playlist = """
            #EXTM3U
            #EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"
            #EXT-X-BYTERANGE:1000@720
            main.m4s
            #EXT-X-BYTERANGE:500
            main.m4s
        """.trimIndent()
        val entries = HlsKeyParser.parsePlaylistEntries(playlist, "https://cdn.example.com/cmaf/prog.m3u8")
        assertEquals(3, entries.size)
        assertTrue(entries[0].isInitSegment)
        assertEquals(0L, entries[0].byteRangeOffset)
        assertEquals(720L, entries[0].byteRangeLength)
        assertEquals(720L, entries[1].byteRangeOffset)
        assertEquals(1000L, entries[1].byteRangeLength)
        assertEquals(1720L, entries[2].byteRangeOffset)
        assertEquals(500L, entries[2].byteRangeLength)
    }

    @Test
    fun linkPatternDetectorExcludesYouTubeAndMatchesSocialAndCdnLinks() {
        val yt = LinkPatternDetector.classify("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assertNotNull(yt)
        assertEquals(LinkPatternCategory.YOUTUBE_EXCLUDED, yt?.category)

        val youtuBe = LinkPatternDetector.classify("https://youtu.be/dQw4w9WgXcQ")
        assertEquals(LinkPatternCategory.YOUTUBE_EXCLUDED, youtuBe?.category)

        val xPost = LinkPatternDetector.classify("https://x.com/nasa/status/1847382910293847?s=20&t=abc")
        assertEquals(LinkPatternCategory.PLATFORM_PAGE, xPost?.category)
        assertEquals(PlatformExtractorKey.X_TWITTER, xPost?.platform)
        assertEquals("1847382910293847", xPost?.mediaId)

        val igReel = LinkPatternDetector.classify("https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Freel%2FC8xAbCd1234%2F%3Figsh%3Dxyz")
        assertEquals(LinkPatternCategory.PLATFORM_PAGE, igReel?.category)
        assertEquals(PlatformExtractorKey.INSTAGRAM, igReel?.platform)
        assertEquals("C8xAbCd1234", igReel?.mediaId)
        assertEquals("reel", igReel?.mediaSubKind)

        val cdnVideo = LinkPatternDetector.classify("https://video.twimg.com/ext_tw_video/123456/pu/vid/720x1280/clip?tag=12")
        assertEquals(LinkPatternCategory.DIRECT_MEDIA, cdnVideo?.category)
        assertEquals("video/mp4", cdnVideo?.inferredMime)
    }
}
