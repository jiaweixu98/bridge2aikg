import { json, type RequestHandler } from '@sveltejs/kit';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const REPORT_OUTPUT_DIR =
  (process.env.REPORT_OUTPUT_DIR || '').trim() || '/home/ubuntu/bridge2aikg/work/data';

type ReportErrorPayload = {
  project?: string;
  page?: string;
  reportFolder?: string;
  context?: Record<string, unknown>;
  feedback?: string;
  currentUrl?: string;
  userAgent?: string;
};

const sanitizeToken = (value: string, fallback: string) => {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
};

const createReportFilename = (project: string, page: string) => {
  const now = new Date();
  const iso = now.toISOString().replace(/[:.]/g, '-');
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `report_error_${project}_${page}_${iso}_${randomSuffix}.json`;
};

const resolveReportFolder = (folder: string) => {
  const normalized = sanitizeToken(folder, 'kg_error');
  const allowed = new Set(['kg_error', 'general_feedback', 'matrix_error']);
  return allowed.has(normalized) ? normalized : 'kg_error';
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  try {
    const body = (await request.json()) as ReportErrorPayload;
    const feedback = String(body.feedback || '').trim();
    if (!feedback) {
      return json({ error: 'feedback is required' }, { status: 400 });
    }

    const project = sanitizeToken(String(body.project || 'bridge2aikg'), 'bridge2aikg');
    const page = sanitizeToken(String(body.page || 'unknown-page'), 'unknown-page');
    const reportFolder = resolveReportFolder(String(body.reportFolder || 'kg_error'));
    const filename = createReportFilename(project, page);
    const outputPath = join(REPORT_OUTPUT_DIR, reportFolder, basename(filename));

    const reportData = {
      report_type: 'error_feedback',
      submitted_at: new Date().toISOString(),
      project,
      page,
      report_folder: reportFolder,
      feedback,
      context: body.context || {},
      current_url: body.currentUrl || null,
      user_agent: body.userAgent || null,
      client_ip: getClientAddress(),
    };

    await mkdir(join(REPORT_OUTPUT_DIR, reportFolder), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(reportData, null, 2)}\n`, 'utf-8');

    return json({
      ok: true,
      filename,
      path: outputPath,
    });
  } catch (error) {
    console.error('Failed to save report error feedback:', error);
    return json({ error: 'Failed to save report error feedback' }, { status: 500 });
  }
};
