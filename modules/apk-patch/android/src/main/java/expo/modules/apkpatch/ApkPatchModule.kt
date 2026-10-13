package expo.modules.apkpatch

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.nio.channels.FileChannel
import java.security.MessageDigest
import java.util.zip.InflaterInputStream

/**
 * APK 增量更新：在设备上把「已安装的旧 APK + 补丁」还原为新 APK（bsdiff 算法，zlib 容器）。
 *
 * 补丁格式 BSZ1：
 *   "BSZ1"(4) | newSize int64 BE | ctrlLen int64 BE | diffLen int64 BE | extraLen int64 BE
 *   | ctrl(zlib) | diff(zlib) | extra(zlib)
 *   ctrl 为若干 (diffLen, extraLen, seek) 三元组，各 8 字节 sign-magnitude 小端（同 bsdiff 的 offtin）。
 */
class ApkPatchModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ApkPatch")

    Function("getBaseApkPath") { context.applicationInfo.sourceDir }

    AsyncFunction("sha256") { path: String -> sha256(File(clean(path))) }

    AsyncFunction("applyPatch") { oldPath: String, patchPath: String, outPath: String ->
      applyPatch(File(clean(oldPath)), File(clean(patchPath)), File(clean(outPath)))
    }
  }

  private fun clean(p: String) = if (p.startsWith("file://")) p.removePrefix("file://") else p

  private fun sha256(f: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    FileInputStream(f).use { ins ->
      val buf = ByteArray(1 shl 16)
      while (true) {
        val n = ins.read(buf)
        if (n < 0) break
        md.update(buf, 0, n)
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }

  private fun offtin(b: ByteArray): Long {
    var y = (b[7].toLong() and 0x7F)
    for (i in 6 downTo 0) y = y * 256 + (b[i].toLong() and 0xFF)
    return if ((b[7].toInt() and 0x80) != 0) -y else y
  }

  private fun readFully(ins: InputStream, buf: ByteArray, len: Int) {
    var off = 0
    while (off < len) {
      val n = ins.read(buf, off, len - off)
      if (n < 0) throw EOFException("patch truncated")
      off += n
    }
  }

  /** 返回新文件的 sha256 */
  private fun applyPatch(oldFile: File, patchFile: File, outFile: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    RandomAccessFile(patchFile, "r").use { pf ->
      val head = ByteArray(36)
      pf.readFully(head)
      if (String(head, 0, 4, Charsets.US_ASCII) != "BSZ1") throw IllegalArgumentException("bad patch magic")
      val din = DataInputStream(java.io.ByteArrayInputStream(head, 4, 32))
      val newSize = din.readLong()
      val ctrlLen = din.readLong()
      val diffLen = din.readLong()
      val extraLen = din.readLong()
      val base = 36L

      fun section(start: Long, len: Long): InputStream {
        val ins = FileInputStream(patchFile)
        ins.channel.position(start)
        val limited = object : InputStream() {
          var left = len
          override fun read(): Int {
            if (left <= 0) return -1
            val v = ins.read(); if (v >= 0) left--; return v
          }
          override fun read(b: ByteArray, o: Int, l: Int): Int {
            if (left <= 0) return -1
            val n = ins.read(b, o, minOf(l.toLong(), left).toInt())
            if (n > 0) left -= n
            return n
          }
          override fun close() = ins.close()
        }
        return InflaterInputStream(BufferedInputStream(limited, 1 shl 16), java.util.zip.Inflater(), 1 shl 16)
      }

      val ctrlIn = section(base, ctrlLen)
      val diffIn = section(base + ctrlLen, diffLen)
      val extraIn = section(base + ctrlLen + diffLen, extraLen)

      RandomAccessFile(oldFile, "r").use { oraf ->
        val oldSize = oraf.length()
        val old = oraf.channel.map(FileChannel.MapMode.READ_ONLY, 0, oldSize)
        outFile.parentFile?.mkdirs()
        FileOutputStream(outFile).use { fout ->
          val ctrl = ByteArray(24)
          val buf = ByteArray(1 shl 16)
          var oldPos = 0L
          var newPos = 0L
          try {
            while (newPos < newSize) {
              readFully(ctrlIn, ctrl, 24)
              val c0 = offtin(ctrl.copyOfRange(0, 8))
              val c1 = offtin(ctrl.copyOfRange(8, 16))
              val c2 = offtin(ctrl.copyOfRange(16, 24))
              if (c0 < 0 || c1 < 0 || newPos + c0 > newSize) throw IllegalStateException("corrupt patch (ctrl)")

              var left = c0
              while (left > 0) {
                val n = minOf(left, buf.size.toLong()).toInt()
                readFully(diffIn, buf, n)
                for (i in 0 until n) {
                  val op = oldPos + i
                  if (op in 0 until oldSize) {
                    buf[i] = (buf[i] + old.get(op.toInt())).toByte()
                  }
                }
                fout.write(buf, 0, n)
                md.update(buf, 0, n)
                oldPos += n
                newPos += n
                left -= n
              }

              if (newPos + c1 > newSize) throw IllegalStateException("corrupt patch (extra)")
              left = c1
              while (left > 0) {
                val n = minOf(left, buf.size.toLong()).toInt()
                readFully(extraIn, buf, n)
                fout.write(buf, 0, n)
                md.update(buf, 0, n)
                newPos += n
                left -= n
              }
              oldPos += c2
            }
          } finally {
            ctrlIn.close(); diffIn.close(); extraIn.close()
          }
          fout.fd.sync()
        }
        if (newPos(outFile) != newSize) throw IllegalStateException("size mismatch")
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }

  private fun newPos(f: File) = f.length()
}
