"""
benchmark-extractor: 结构化抽取多篇论文的实验信息
产出任务/数据集/指标/baseline/SOTA 对比表。

Usage:
    python benchmark.py --urls "https://arxiv.org/abs/2210.03629,https://arxiv.org/abs/2305.10601"
    python benchmark.py --task "GSM8K" --urls "url1,url2,url3"
"""

import os
import sys
import json
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from utils import llm_chat, get_llm_model


EXTRACT_SYSTEM_PROMPT = """你是一个实验信息抽取专家。从论文中抽取结构化的实验信息。

**硬约束**：
1. 不确定的字段必须显式标"未知"，绝对不脑补。
2. 数字必须来自论文原文，不能估算。
3. 开源状态：只写 true/false/unknown，不要猜测。

输出 JSON：
{
  "task": "任务名",
  "datasets": [{"name": "数据集名", "size": "样本数或未知", "description": "简短描述"}],
  "metrics": ["使用的指标"],
  "baselines": ["对比的 baseline 方法"],
  "sota_claim": "SOTA 声明或未知",
  "results": [
    {"metric": "指标名", "baseline_best": "数字或未知", "this_paper": "数字或未知", "improvement": "提升量或未知"}
  ],
  "evaluation_setup": "评测设置描述",
  "code_available": "true|false|unknown",
  "code_url": "repo URL 或未知"
}
"""


def extract_experiments(paper: dict, model: str = None) -> dict:
    """Extract structured experiment info from a single paper."""
    if not model:
        model = get_llm_model()

    user_prompt = f"""论文：{paper['title']}
摘要：{paper.get('summary', '')[:2000]}

请抽取实验信息。"""

    try:
        result = llm_chat(
            messages=[
                {"role": "system", "content": EXTRACT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            model=model,
            temperature=0.1,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )
        data = json.loads(result)
        data["paper_title"] = paper["title"]
        data["arxiv_id"] = paper.get("arxiv_id", "")
        return data
    except Exception as e:
        return {"paper_title": paper["title"], "error": str(e)}


def build_comparison_table(extractions: list[dict]) -> str:
    """Build a markdown comparison table from multiple extractions."""
    lines = ["# Benchmark 对比", ""]

    # Collect all unique metrics across papers
    all_metrics = set()
    all_datasets = set()
    all_baselines = set()
    paper_summaries = []

    for ext in extractions:
        if "error" in ext:
            continue
        all_metrics.update(ext.get("metrics", []))
        all_datasets.update(d.get("name") for d in ext.get("datasets", []))
        all_baselines.update(ext.get("baselines", []))
        paper_summaries.append({
            "title": ext.get("paper_title", ""),
            "task": ext.get("task", ""),
            "datasets": ext.get("datasets", []),
            "metrics": ext.get("metrics", []),
            "baselines": ext.get("baselines", []),
            "sota_claim": ext.get("sota_claim", ""),
            "code_available": ext.get("code_available", "unknown"),
        })

    lines.append("## 论文概览")
    lines.append("")
    lines.append("| 论文 | 任务 | 数据集 | 指标 | Baselines | SOTA 声明 | 代码 |")
    lines.append("|------|------|--------|------|-----------|-----------|------|")
    for ps in paper_summaries:
        datasets = ", ".join(d["name"] for d in ps["datasets"][:3]) or "未知"
        metrics = ", ".join(ps["metrics"][:3]) or "未知"
        baselines = ", ".join(ps["baselines"][:3]) or "未知"
        code = {"true": "✅", "false": "❌", "unknown": "❓"}.get(ps["code_available"], "❓")
        lines.append(
            f"| {ps['title'][:40]} | {ps['task']} | {datasets} | {metrics} | {baselines} | {ps['sota_claim']} | {code} |"
        )

    lines.append("")
    lines.append("## 详细实验结果")
    lines.append("")

    for ext in extractions:
        if "error" in ext:
            continue
        lines.append(f"### {ext.get('paper_title', '')}")
        lines.append(f"- 评测设置: {ext.get('evaluation_setup', '未知')}")
        lines.append("")
        results = ext.get("results", [])
        if results:
            lines.append("| 指标 | Baseline Best | 本文 | 提升 |")
            lines.append("|------|--------------|------|------|")
            for r in results:
                lines.append(
                    f"| {r.get('metric', '')} | {r.get('baseline_best', '未知')} | {r.get('this_paper', '未知')} | {r.get('improvement', '未知')} |"
                )
        lines.append("")

    return "\n".join(lines)


def run_benchmark(urls: list[str], task: str = None, dry_run: bool = False, model: str = None):
    """Run benchmark extraction for multiple papers."""
    from reading import fetch_single_paper

    print(f"[benchmark] Processing {len(urls)} papers...")

    # Fetch all papers
    papers = []
    for url in urls:
        try:
            paper = fetch_single_paper(url.strip())
            papers.append(paper)
            print(f"  ✅ {paper['title'][:60]}")
        except Exception as e:
            print(f"  ❌ Failed to fetch {url}: {e}")

    if not papers:
        print("[benchmark] No papers to process")
        return

    # Extract experiments in parallel
    extractions = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(extract_experiments, p, model): p["arxiv_id"] for p in papers}
        for future in as_completed(futures):
            try:
                ext = future.result()
                extractions.append(ext)
            except Exception as e:
                print(f"[benchmark extraction error] {e}")

    # Build comparison table
    table = build_comparison_table(extractions)

    if dry_run:
        print("\n[DRY RUN] Comparison table:")
        print(table)
        return

    # Save
    os.makedirs("output", exist_ok=True)
    filepath = f"output/benchmark_{task or 'comparison'}.md"
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(table)
    print(f"[benchmark] ✅ Saved to {filepath}")


def main():
    parser = argparse.ArgumentParser(description="Benchmark Extractor")
    parser.add_argument("--urls", type=str, required=True, help="Comma-separated arxiv URLs or IDs")
    parser.add_argument("--task", type=str, help="Target task name, e.g. GSM8K")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    urls = [u.strip() for u in args.urls.split(",") if u.strip()]
    run_benchmark(urls=urls, task=args.task, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
