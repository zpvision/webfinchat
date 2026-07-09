import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

// START: FileDownloadService
class FileDownloadService {
  final Dio _dio;
  final String _baseUrl;
  final String _apiKey;

  FileDownloadService({
    required Dio dio,
    required String baseUrl,
    required String apiKey,
  })  : _dio = dio,
        _baseUrl = baseUrl,
        _apiKey = apiKey;

  /// Downloads a file from the server.
  /// [ref] is the relative URL (e.g., /v0/file/s/REF_ID) or just the REF_ID.
  /// [onProgress] is an optional callback for progress updates.
  Future<File> downloadFile(
    String ref,
    String token, {
    String? fileName,
    void Function(int count, int total)? onProgress,
  }) async {
    try {
      // 1. Normalize ref and build URL
      String normalizedRef = ref;
      if (!ref.startsWith('http')) {
        if (!ref.startsWith('/')) {
          normalizedRef = '/v0/file/s/$ref';
        } else if (!ref.startsWith('/v0/')) {
          // If it starts with / but not /v0/, it might be a partial path
          normalizedRef = '/v0/file/s$ref';
        }
      }

      final url =
          normalizedRef.startsWith('http') ? normalizedRef : '$_baseUrl$normalizedRef';

      final appDir = await getApplicationDocumentsDirectory();
      final attachmentsDir = Directory(p.join(appDir.path, 'attachments'));
      if (!await attachmentsDir.exists()) {
        await attachmentsDir.create(recursive: true);
      }

      // Try to extract filename or use ref as name
      final fileNameFromUrl = p.basename(url);
      final String finalFileName;
      if (fileName != null && fileName.isNotEmpty) {
        final dirPath = p.join(attachmentsDir.path, fileNameFromUrl);
        final subDir = Directory(dirPath);
        if (!await subDir.exists()) {
          await subDir.create(recursive: true);
        }
        finalFileName = p.join(fileNameFromUrl, fileName);
      } else {
        finalFileName = fileNameFromUrl;
      }

      final savePath = p.join(attachmentsDir.path, finalFileName);
      final file = File(savePath);

      if (await file.exists()) {
        return file;
      }

      debugPrint('FileDownloadService: downloading from $url');

      final response = await _dio.download(
        url,
        savePath,
        onReceiveProgress: onProgress,
        queryParameters: {
          'apikey': _apiKey,
          // Add auth as query params as a fallback for the Authorization header
          // according to API.md section "Out-of-Band Handling of Large Files"
          'auth': 'token',
          'secret': token,
        },
        options: Options(
          headers: {
            'X-Finchat-APIKey': _apiKey,
            'X-Finchat-Auth': 'Token $token',
          },
          // Ensure we follow redirects correctly
          followRedirects: true,
          validateStatus: (status) => status == 200,
        ),
      );

      final downloadedFile = File(savePath);
      if (!await downloadedFile.exists()) {
        throw Exception('File was not saved to $savePath');
      }

      // Check if response is a JSON error from the server instead of the actual file
      final contentType = response.headers.value('content-type');
      if (contentType != null && contentType.contains('application/json')) {
        try {
          final content = await downloadedFile.readAsString();
          final parsed = jsonDecode(content);
          if (parsed is Map &&
              (parsed.containsKey('ctrl') ||
                  parsed.containsKey('error') ||
                  parsed.containsKey('err'))) {
            // Clean up the invalid file before throwing
            try {
              await downloadedFile.delete();
            } catch (_) {}
            final errorText = parsed['error'] ?? parsed['err'] ?? (parsed['ctrl'] as Map?)?['text'] ?? 'Unknown server error';
            throw Exception('Server returned error instead of file: $errorText');
          }
        } catch (_) {
          // If JSON parsing fails, treat it as a normal file
        }
      }

      return downloadedFile;
    } catch (e, stack) {
      debugPrint('FileDownloadService: download error: $e\n$stack');
      rethrow;
    }
  }
}
// END: FileDownloadService
