import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:mime/mime.dart';
import 'package:path/path.dart' as p;

import 'package:http_parser/http_parser.dart';

// START: FileUploadService
class FileUploadService {
  final Dio _dio;
  final String _baseUrl;
  final String _apiKey;
  final Dio Function() _uploadDioFactory;

  FileUploadService({
    required Dio dio,
    required String baseUrl,
    required String apiKey,
    Dio Function()? uploadDioFactory,
  }) : _dio = dio,
       _baseUrl = baseUrl,
       _apiKey = apiKey,
       _uploadDioFactory = uploadDioFactory ?? (() => Dio());

  String _getMime(String path) {
    return lookupMimeType(path) ?? 'application/octet-stream';
  }

  /// Uploads a file using Direct Upload via Presigned URL.
  /// Returns the relative URL of the uploaded file (ref).
  Future<String> uploadFile(File file, String token) async {
    try {
      final fileName = p.basename(file.path);
      final ext = p.extension(file.path);
      final mimeString = _getMime(file.path);

      final queryParams = <String, dynamic>{
        'direct': 'true',
      };
      if (ext.isNotEmpty) {
        queryParams['ext'] = ext.startsWith('.') ? ext.substring(1) : ext;
      } else if (mimeString.isNotEmpty) {
        queryParams['mime'] = mimeString;
      }

      if (kDebugMode) {
        debugPrint('FileUploadService: requesting presigned URL for $fileName (ext: $ext, mime: $mimeString)');
      }

      final response = await _dio.post(
        '$_baseUrl/v0/file/u',
        queryParameters: queryParams,
        options: Options(
          headers: {
            'X-Finchat-APIKey': _apiKey,
            'X-Finchat-Auth': 'Token $token',
          },
        ),
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final data = response.data as Map<String, dynamic>;
        final ctrl = data['ctrl'] as Map<String, dynamic>?;

        if (ctrl != null && ctrl['code'] == 200) {
          final params = ctrl['params'] as Map<String, dynamic>?;
          if (params != null) {
            final url = params['url'] as String?;
            final uploadUrl = params['upload_url'] as String?;
            final uploadMethod = params['upload_method'] as String? ?? 'PUT';
            final contentType = params['content_type'] as String?;
            final cacheControl = params['cache_control'] as String?;

            if (url != null && uploadUrl != null && contentType != null && cacheControl != null) {
              if (kDebugMode) {
                debugPrint('FileUploadService: got presigned URL, uploading file directly to Object Storage via $uploadMethod');
              }

              // Use a clean Dio instance to prevent sending application auth headers to the Object Storage
              final uploadDio = _uploadDioFactory();
              final fileLength = await file.length();

              final uploadResponse = await uploadDio.request(
                uploadUrl,
                data: file.openRead(),
                options: Options(
                  method: uploadMethod,
                  headers: {
                    'Content-Type': contentType,
                    'Cache-Control': cacheControl,
                    'Content-Length': fileLength,
                  },
                ),
              );

              if (uploadResponse.statusCode == 200 ||
                  uploadResponse.statusCode == 201 ||
                  uploadResponse.statusCode == 204) {
                if (kDebugMode) {
                  debugPrint('FileUploadService: upload completed successfully. Ref URL: $url');
                }
                return url;
              } else {
                throw Exception(
                  'Failed to upload file to Object Storage: HTTP ${uploadResponse.statusCode}',
                );
              }
            }
          }
        }

        throw Exception(
          'Failed to obtain presigned URL: ${ctrl?['text'] ?? 'Unknown error'}',
        );
      } else {
        throw Exception('Failed to obtain presigned URL: HTTP ${response.statusCode}');
      }
    } catch (e) {
      if (kDebugMode) {
        debugPrint('FileUploadService: upload error: $e');
      }
      if (e is DioException) {
        if (e.response?.statusCode == 413) {
          throw Exception(
            'File is too large for the server to process (HTTP 413 Payload Too Large).',
          );
        }
      }
      rethrow;
    }
  }
}

// END: FileUploadService
