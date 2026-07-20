import { useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "./Modal";
import { showToast } from "./Toast";

interface Props {
  open: boolean;
  onClose: () => void;
  version: string;
  downloadUrl: string;
}

export default function UpdateConfirmModal({ open, onClose, version, downloadUrl }: Props) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      const { open: openExternal } = await import("@tauri-apps/plugin-shell");
      await openExternal(downloadUrl);
      showToast("info", "已打开安装包下载链接，请下载后手动安装。");
      onClose();
    } catch (err) {
      showToast("error", `打开下载链接失败: ${err}`);
    } finally {
      setIsUpdating(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={isUpdating ? () => {} : onClose}
      title="软件更新"
      width="max-w-xs"
    >
      <div className="space-y-4 text-center py-2">
        <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-1">
          <Download size={20} className="text-accent" />
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">发现新版本 v{version.replace(/^v/, "")}</p>
          <p className="text-sm text-text-muted mt-1 leading-normal">将打开完整安装包下载链接，请下载后手动安装。</p>
        </div>
        <div className="flex gap-2.5 pt-2">
          <button
            disabled={isUpdating}
            onClick={onClose}
            className="flex-1 h-8 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-all duration-150 border border-border disabled:opacity-50"
          >
            稍后
          </button>
          <button
            disabled={isUpdating}
            onClick={handleUpdate}
            className="flex-1 h-8 rounded-lg text-sm font-medium text-white hover:opacity-90 active:scale-[0.97] transition-all duration-150 bg-accent disabled:opacity-50"
          >
            {isUpdating ? "正在打开..." : "下载安装包"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
