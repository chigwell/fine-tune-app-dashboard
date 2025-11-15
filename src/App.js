import React, {
  useCallback,
  useEffect,
  useState,
  Fragment,
  useRef,
} from "react";
import {
  App,
  View,
  Page,
  Navbar,
  NavTitle,
  LoginScreen,
  LoginScreenTitle,
  Block,
  BlockTitle,
  Button,
  Panel,
  Preloader,
  List,
  ListInput,
  ListItem,
  NavRight,
  NavLeft,
  f7,
  Card,
  CardHeader,
  CardContent,
  Icon,
  Link,
  Popup,
  Toolbar,
} from "framework7-react";
import axios from "axios";
import Switch from "react-switch";

import * as am5 from "@amcharts/amcharts5";
import * as am5xy from "@amcharts/amcharts5/xy";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";
import { FileUploader } from "react-drag-drop-files";

/* -------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------- */
const GA_CLIENT_ID =
  "898209999878-7o1vj2p6cj1sfmek83f81n16pec3vqdb.apps.googleusercontent.com";
const BASE_API_URL = "http://0.0.0.0:8000";
const ID_TOKEN_KEY = "id_token";
const SHARED_COOKIE_DOMAIN = "fine-tune.app";
const SHARED_COOKIE_PATH = "/";
const FILE_TYPES = ["DOCX", "TXT", "PDF"];
const MAX_FILE_PREVIEW = 3;

// --- Cross-subdomain cookie helpers ----------------------------------------

function setSharedCookie(name: string, value: string, maxAgeSec) {
  document.cookie = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `Domain=${SHARED_COOKIE_DOMAIN}`,
    `Path=${SHARED_COOKIE_PATH}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function getSharedCookie(name: string): string | null {
  const target = `${encodeURIComponent(name)}=`;
  const found = document.cookie.split("; ").find((p) => p.startsWith(target));
  return found ? decodeURIComponent(found.slice(target.length)) : null;
}

function deleteSharedCookie(name: string) {
  document.cookie = [
    `${encodeURIComponent(name)}=`,
    `Domain=${SHARED_COOKIE_DOMAIN}`,
    `Path=${SHARED_COOKIE_PATH}`,
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function jwtMaxAgeSeconds(jwt: string) {
  try {
    const [, payloadB64] = jwt.split(".");
    const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json);
    const ms = Math.max(0, exp * 1000 - Date.now());
    return Math.floor(ms / 1000);
  } catch {
    return 3600;
  }
}

const renderFilePreview = (files: any[]) => {
  if (!files || files.length === 0) {
    return "";
  }

  const names = files.slice(0, MAX_FILE_PREVIEW).map((f) => f.filename);
  const moreCount = files.length - names.length;

  if (moreCount > 0) {
    return `${names.join(", ")} +${moreCount} more`;
  }

  return names.join(", ");
};

/**
 * @typedef {"idle" | "pending" | "running" | "succeeded" | "failed"} StageStatus
 */

/**
 * @typedef {Object} FtTask
 * @property {string} id
 * @property {string} name
 * @property {string} createdAt
 * @property {File[]} files
 * @property {StageStatus} datasetStatus
 * @property {StageStatus} ftStatus
 * @property {StageStatus} benchmarkStatus
 * @property {number | null} datasetTotalFiles
 * @property {number | null} datasetProcessedFiles
 * @property {number | null} datasetTotalChunks
 * @property {number | null} datasetProcessedChunks
 * @property {number | null} datasetTotalRows
 * @property {string | null} datasetError
 * @property {string | null} datasetPath
 * @property {number | null} ftProgressPercent
 * @property {number | null} ftCurrentEpoch
 * @property {number | null} ftTotalEpochs
 * @property {string | null} ftLastMessage
 * @property {string | null} ftError
 * @property {string | null} hfRepoId
 * @property {StageStatus} ggufStatus
 * @property {string | null} ggufQuantization
 * @property {string | null} ggufPath
 * @property {StageStatus} ollamaStatus
 * @property {string | null} ollamaModelName
 */


/**
 * Map raw backend enum to UI status.
 */
const mapStageStatus = (rawStatus: string | null | undefined): StageStatus => {
  switch (rawStatus) {
    case "PENDING":
      return "pending";
    case "RUNNING":
      return "running";
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "NOT_REQUESTED":
    default:
      return "idle";
  }
};

const mapDatasetStatus = (
  rawStatus: string | null | undefined,
): StageStatus => {
  return mapStageStatus(rawStatus);
};

/* -------------------------------------------------------------------------
 * Component
 * ---------------------------------------------------------------------- */
function MyApp() {
  /* --------------------------- Auth state ------------------------------ */
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [createdTokenString, setCreatedTokenString] = useState("");
  const [isCreatedTokenPopupOpen, setIsCreatedTokenPopupOpen] =
    useState(false);
  const [isTermsAccepted, setIsTermsAccepted] = useState(false);

  /* --------------------------- Task state ---------------------------- */
  /** @type {[FtTask[], Function]} */
  const [tasks, setTasks] = useState([]);
  const [isTasksLoading, setIsTasksLoading] = useState(false);

  /* --------------------------- Add-popup ------------------------------ */
  const [isAddPopupOpen, setIsAddPopupOpen] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  /** @type {[File[], Function]} */
  const [newTaskFiles, setNewTaskFiles] = useState([]);

  /* --------------------------- Dataset popup -------------------------- */
  const [datasetPopup, setDatasetPopup] = useState({
    isOpen: false,
    taskId: null,
    status: "idle",
    error: "",
    totalFiles: null,
    processedFiles: null,
    totalChunks: null,
    processedChunks: null,
    totalRows: null,
  });

  const datasetPollRef = useRef(null);

  /* --------------------------- FT popup ------------------------------- */
  const [ftPopup, setFtPopup] = useState({
    isOpen: false,
    sourceTaskId: null, // dataset task id
    ftTaskId: null, // created FT task id
    status: "idle",
    error: "",
    baseModel: "google/gemma-2-9b-it",
    hubModelId: "",
    numTrainEpochs: 1,
    learningRate: 1e-5,
    perDeviceTrainBatchSize: 4,
    maxLength: 2048,
    hfToken: "",
    lastMessage: "",
    progressPercent: null,
    currentEpoch: null,
    totalEpochs: null,
  });

  const ftPollRef = useRef(null);

    const [resultPopup, setResultPopup] = useState({
    isOpen: false,
    taskId: null,
    hfRepoId: "",
    ggufStatus: "idle",
    ggufQuantization: "",
    ggufPath: "",
    ggufError: "",
    ollamaStatus: "idle",
    ollamaModelName: "",
    ollamaError: "",
    quantizationMethod: "f16",
    ollamaModelNameInput: "",
    ollamaSystemPrompt: "",
    ollamaTemperature: 0.7,
    ollamaPushToRegistry: false,
    ollamaRegistryModelName: "",
    ollamaApiKey: "",
  });

  const ggufPollRef = useRef(null);
  const ollamaPollRef = useRef(null);



  /* --------------------------- Inline edit ---------------------------- */
  const [editingTokenId, setEditingTokenId] = useState(null);
  const [editingName, setEditingName] = useState("");

  const stopDatasetPolling = () => {
    if (datasetPollRef.current !== null) {
      window.clearInterval(datasetPollRef.current);
      datasetPollRef.current = null;
    }
  };

  const fetchDatasetStatus = async (taskId: string) => {
    const token =
      localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);
    if (!token) return;

    try {
      const { data } = await axios.get(
        `${BASE_API_URL}/tasks/${taskId}/dataset`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const mappedStatus = mapDatasetStatus(data.dataset_status);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                datasetStatus: mappedStatus,
                datasetTotalFiles: data.total_files ?? null,
                datasetProcessedFiles: data.processed_files ?? null,
                datasetTotalChunks: data.total_chunks ?? null,
                datasetProcessedChunks: data.processed_chunks ?? null,
                datasetTotalRows: data.total_rows ?? null,
                datasetError: data.dataset_error ?? null,
                datasetPath: data.dataset_path ?? t.datasetPath ?? null,
              }
            : t,
        ),
      );

      setDatasetPopup((prev) =>
        prev.taskId === taskId
          ? {
              ...prev,
              status: mappedStatus,
              error: data.dataset_error ?? "",
              totalFiles: data.total_files ?? null,
              processedFiles: data.processed_files ?? null,
              totalChunks: data.total_chunks ?? null,
              processedChunks: data.processed_chunks ?? null,
              totalRows: data.total_rows ?? null,
            }
          : prev,
      );

      if (mappedStatus === "succeeded" || mappedStatus === "failed") {
        stopDatasetPolling();
      }
    } catch (err) {
      console.error("Failed to fetch dataset status", err);
    }
  };

  const startDatasetPolling = (taskId: string) => {
    stopDatasetPolling();
    datasetPollRef.current = window.setInterval(() => {
      fetchDatasetStatus(taskId);
    }, 2000);
  };


  const stopFtPolling = () => {
    if (ftPollRef.current !== null) {
      window.clearInterval(ftPollRef.current);
      ftPollRef.current = null;
    }
  };

  const fetchFtStatus = async (ftTaskId: string) => {
    const token =
      localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);
    if (!token) return;

    try {
      const { data } = await axios.get(
        `${BASE_API_URL}/tasks/${ftTaskId}/status`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const mappedStatus: StageStatus =
        data.status === "SUCCEEDED"
          ? "succeeded"
          : data.status === "FAILED"
          ? "failed"
          : data.status === "PENDING"
          ? "pending"
          : data.status === "RUNNING"
          ? "running"
          : "idle";

      setTasks((prev) =>
        prev.map((t) =>
          t.id === ftTaskId
            ? {
                ...t,
                ftStatus: mappedStatus,
                ftProgressPercent: data.progress_percent ?? null,
                ftCurrentEpoch: data.current_epoch ?? null,
                ftTotalEpochs: data.total_epochs ?? null,
                ftLastMessage: data.last_message ?? null,
              }
            : t,
        ),
      );

      setFtPopup((prev) =>
        prev.ftTaskId === ftTaskId
          ? {
              ...prev,
              status: mappedStatus,
              progressPercent: data.progress_percent ?? null,
              currentEpoch: data.current_epoch ?? null,
              totalEpochs: data.total_epochs ?? null,
              lastMessage: data.last_message ?? "",
            }
          : prev,
      );

      if (mappedStatus === "succeeded" || mappedStatus === "failed") {
        stopFtPolling();
      }
    } catch (err) {
      console.error("Failed to fetch FT status", err);
    }
  };

  const startFtPolling = (ftTaskId: string) => {
    stopFtPolling();
    ftPollRef.current = window.setInterval(() => {
      fetchFtStatus(ftTaskId);
    }, 3000);
  };

    const stopGgufPolling = () => {
    if (ggufPollRef.current !== null) {
      window.clearInterval(ggufPollRef.current);
      ggufPollRef.current = null;
    }
  };

  const fetchGgufStatus = async (taskId: string) => {
    const token =
      localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);
    if (!token) return;

    try {
      const { data } = await axios.get(
        `${BASE_API_URL}/tasks/${taskId}/gguf`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const mappedStatus = mapStageStatus(data.gguf_status);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                ggufStatus: mappedStatus,
                ggufQuantization: data.gguf_quantization ?? null,
                ggufPath: data.gguf_path ?? null,
              }
            : t,
        ),
      );

      setResultPopup((prev) =>
        prev.taskId === taskId
          ? {
              ...prev,
              ggufStatus: mappedStatus,
              ggufQuantization: data.gguf_quantization ?? "",
              ggufPath: data.gguf_path ?? "",
              ggufError: data.error ?? "",
            }
          : prev,
      );

      if (mappedStatus === "succeeded" || mappedStatus === "failed") {
        stopGgufPolling();
      }
    } catch (err) {
      console.error("Failed to fetch GGUF status", err);
    }
  };

  const startGgufPolling = (taskId: string) => {
    stopGgufPolling();
    ggufPollRef.current = window.setInterval(() => {
      fetchGgufStatus(taskId);
    }, 3000);
  };

  const stopOllamaPolling = () => {
    if (ollamaPollRef.current !== null) {
      window.clearInterval(ollamaPollRef.current);
      ollamaPollRef.current = null;
    }
  };

  const fetchOllamaStatus = async (taskId: string) => {
    const token =
      localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);
    if (!token) return;

    try {
      const { data } = await axios.get(
        `${BASE_API_URL}/tasks/${taskId}/ollama`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const mappedStatus = mapStageStatus(data.ollama_status);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                ollamaStatus: mappedStatus,
                ollamaModelName: data.ollama_model_name ?? null,
              }
            : t,
        ),
      );

      setResultPopup((prev) =>
        prev.taskId === taskId
          ? {
              ...prev,
              ollamaStatus: mappedStatus,
              ollamaModelName: data.ollama_model_name ?? "",
              ollamaError: data.error ?? "",
            }
          : prev,
      );

      if (mappedStatus === "succeeded" || mappedStatus === "failed") {
        stopOllamaPolling();
      }
    } catch (err) {
      console.error("Failed to fetch Ollama status", err);
    }
  };

  const startOllamaPolling = (taskId: string) => {
    stopOllamaPolling();
    ollamaPollRef.current = window.setInterval(() => {
      fetchOllamaStatus(taskId);
    }, 3000);
  };


  useEffect(() => {
    return () => {
      stopDatasetPolling();
      stopFtPolling();
      stopGgufPolling();
      stopOllamaPolling();
    };
  }, []);

  /* ---------------- Google credential response ------------------------ */
  const handleCredentialResponse = useCallback(
    async ({ credential }: { credential: string }) => {
      setIsLoading(true);
      try {
        const { data } = await axios.get(`${BASE_API_URL}/verify`, {
          headers: { Authorization: `Bearer ${credential}` },
        });
        localStorage.setItem(ID_TOKEN_KEY, credential);
        setSharedCookie(ID_TOKEN_KEY, credential, jwtMaxAgeSeconds(credential));
        setUserEmail(data.email);
        setIsAuthenticated(true);
      } catch {
        localStorage.removeItem(ID_TOKEN_KEY);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  /* ------------------------ Google script ----------------------------- */
  const loadGoogleScript = useCallback(() => {
    if (document.getElementById("gsi-client")) return;

    const script = document.createElement("script");
    script.id = "gsi-client";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      // @ts-ignore – GSI global
      window.google.accounts.id.initialize({
        client_id: GA_CLIENT_ID,
        callback: handleCredentialResponse,
      });
      // @ts-ignore
      window.google.accounts.id.renderButton(
        document.getElementById("google-signin-button"),
        { theme: "outline", size: "large" },
      );
    };
    document.body.appendChild(script);
  }, [handleCredentialResponse]);

  /* --------------------- Verify stored token -------------------------- */
  const verifyStoredToken = useCallback(async () => {
    const token =
      localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);
    if (!token) return;

    setIsLoading(true);
    try {
      const { data } = await axios.get(`${BASE_API_URL}/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUserEmail(data.email);
      setIsAuthenticated(true);
    } catch {
      localStorage.removeItem(ID_TOKEN_KEY);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /* --------------------------- Mount ---------------------------------- */
  useEffect(() => {
    loadGoogleScript();
    verifyStoredToken();
  }, [loadGoogleScript, verifyStoredToken, handleCredentialResponse]);

  /* --------------------------- Logout --------------------------------- */
  const handleLogout = () => {
    localStorage.removeItem(ID_TOKEN_KEY);
    deleteSharedCookie(ID_TOKEN_KEY);
    setIsAuthenticated(false);
    setUserEmail("");
    setTasks([]);
    window.location.reload();
  };

  const fetchTasksFromBackend = useCallback(async () => {
    const token =
      localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);

    if (!token) {
      return;
    }

    setIsTasksLoading(true);

    try {
      const { data } = await axios.get(`${BASE_API_URL}/tasks`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const mappedTasks = (data || []).map((t: any) => {
          const hfRepoId = t.hf_repo_id ?? null;
          const ggufStatus: StageStatus = mapStageStatus(t.gguf_status);
          const ollamaStatus: StageStatus = mapStageStatus(t.ollama_status);
        const createdAtIso =
          t.created_at ?? t.updated_at ?? new Date().toISOString();

        const files =
          (t.files || []).map((f: any) => ({
            id: f.id,
            filename: f.filename,
            sizeBytes: f.size_bytes,
            createdAt: f.created_at,
          })) ?? [];

        const isDraft = t.status === "DRAFT";

        const datasetStatus = mapDatasetStatus(t.dataset_status);

        const ftStatus: StageStatus = isDraft
          ? "idle"
          : t.status === "SUCCEEDED"
          ? "succeeded"
          : t.status === "FAILED"
          ? "failed"
          : t.status === "PENDING"
          ? "pending"
          : "running";

        /** @type {FtTask} */
        const task: FtTask = {
          id: t.task_id,
          name: t.notes || t.hub_model_id || t.base_model || t.task_id,
          createdAt: createdAtIso,
          files,
          ftStatus,
          datasetStatus,
          benchmarkStatus: "idle",
          datasetTotalFiles: t.dataset_total_files ?? null,
          datasetProcessedFiles: t.dataset_processed_files ?? null,
          datasetTotalChunks: t.dataset_total_chunks ?? null,
          datasetProcessedChunks: t.dataset_processed_chunks ?? null,
          datasetTotalRows: t.dataset_total_rows ?? null,
          datasetError: t.dataset_error ?? null,
          datasetPath: t.dataset_path ?? null,
          ftProgressPercent: t.progress_percent ?? null,
          ftCurrentEpoch: t.current_epoch ?? null,
          ftTotalEpochs: t.total_epochs ?? null,
          ftLastMessage: t.last_message ?? null,
          ftError: t.error ?? null,
          hfRepoId,
          ggufStatus,
          ggufQuantization: t.gguf_quantization ?? null,
          ggufPath: t.gguf_path ?? null,
          ollamaStatus,
          ollamaModelName: t.ollama_model_name ?? null,
        };

        return task;
      });

      setTasks(mappedTasks);
    } catch (err) {
      console.error("Failed to load tasks", err);
      setTasks([]);
    } finally {
      setIsTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTasksFromBackend();
    }
  }, [isAuthenticated, fetchTasksFromBackend]);

  /* --------------------------- UI helpers ----------------------------- */
  const openAddPopup = () => {
    setNewTaskName("");
    setNewTaskFiles([]);
    setIsAddPopupOpen(true);
  };

  const formatFileSizeMb = (file: File | any) => {
    if (!file || typeof file.size !== "number") return "?";
    return (file.size / (1024 * 1024)).toFixed(2);
  };

  const handleRemoveNewTaskFile = (indexToRemove: number) => {
    setNewTaskFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const handleNewTaskFilesChange = (files: any) => {
    let list: File[] = [];

    if (files instanceof File) {
      list = [files];
    } else if (Array.isArray(files)) {
      list = files;
    } else if (files && typeof files === "object" && "length" in files) {
      list = Array.from(files);
    }

    setNewTaskFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const next = [...prev];

      for (const file of list) {
        const key = `${file.name}-${file.size}`;
        if (!existingKeys.has(key)) {
          next.push(file);
          existingKeys.add(key);
        }
      }

      return next;
    });
  };

  const handleCreateTask = async () => {
    if (!newTaskName.trim()) {
      f7.toast
        .create({ text: "Please enter a task name", closeTimeout: 2000 })
        .open();
      return;
    }

    if (!newTaskFiles.length) {
      f7.toast
        .create({
          text: "Please add at least one training file",
          closeTimeout: 2000,
        })
        .open();
      return;
    }

    const token =
      localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);

    if (!token) {
      f7.toast
        .create({
          text: "Missing auth token, please sign in again",
          closeTimeout: 2000,
        })
        .open();
      return;
    }

    try {
      setIsTasksLoading(true);

      // 1) Create draft task
      const draftResp = await axios.post(
        `${BASE_API_URL}/tasks/draft`,
        { name: newTaskName.trim() },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const taskId = draftResp.data.task_id;

      // 2) Upload files for this task
      const formData = new FormData();
      newTaskFiles.forEach((file) => {
        formData.append("files", file);
      });

      await axios.post(`${BASE_API_URL}/tasks/${taskId}/files`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      // 3) Refresh list from backend
      await fetchTasksFromBackend();

      // 4) Reset popup state
      setNewTaskName("");
      setNewTaskFiles([]);
      setIsAddPopupOpen(false);

      f7.toast
        .create({ text: "Draft task created", closeTimeout: 2000 })
        .open();
    } catch (err) {
      console.error("Failed to create draft task", err);
      f7.dialog.alert(
        "Failed to create the task. Please try again.",
        "Error",
      );
    } finally {
      setIsTasksLoading(false);
    }
  };

  const handleGenerateDataset = async (taskId: string) => {
    const token =
      localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);

    if (!token) {
      f7.toast
        .create({
          text: "Missing auth token, please sign in again",
          closeTimeout: 2000,
        })
        .open();
      return;
    }

    const existingTask = tasks.find((t) => t.id === taskId);

    // If dataset already in progress or finished, just open the popup and (if needed) start polling
    if (existingTask) {
      if (
        existingTask.datasetStatus === "pending" ||
        existingTask.datasetStatus === "running" ||
        existingTask.datasetStatus === "succeeded"
      ) {
        setDatasetPopup({
          isOpen: true,
          taskId,
          status: existingTask.datasetStatus,
          error: existingTask.datasetError ?? "",
          totalFiles: existingTask.datasetTotalFiles ?? null,
          processedFiles: existingTask.datasetProcessedFiles ?? null,
          totalChunks: existingTask.datasetTotalChunks ?? null,
          processedChunks: existingTask.datasetProcessedChunks ?? null,
          totalRows: existingTask.datasetTotalRows ?? null,
        });

        if (
          existingTask.datasetStatus === "pending" ||
          existingTask.datasetStatus === "running"
        ) {
          startDatasetPolling(taskId);
        }

        return;
      }
    }

    // Start a new dataset job
    setDatasetPopup({
      isOpen: true,
      taskId,
      status: "pending",
      error: "",
      totalFiles: null,
      processedFiles: null,
      totalChunks: null,
      processedChunks: null,
      totalRows: null,
    });

    try {
      const { data } = await axios.post(
        `${BASE_API_URL}/tasks/${taskId}/dataset`,
        {
          system_prompt: "You generate QA pairs ONLY from the provided text.",
          chunk_length: 180,
          max_attempts: 2,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const mappedStatus = mapDatasetStatus(data.dataset_status);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                datasetStatus: mappedStatus,
                datasetTotalFiles: data.total_files ?? null,
                datasetProcessedFiles: data.processed_files ?? null,
                datasetTotalChunks: data.total_chunks ?? null,
                datasetProcessedChunks: data.processed_chunks ?? null,
                datasetTotalRows: data.total_rows ?? null,
                datasetError: data.dataset_error ?? null,
              }
            : t,
        ),
      );

      setDatasetPopup((prev) => ({
        ...prev,
        status: mappedStatus,
        error: data.dataset_error ?? "",
        totalFiles: data.total_files ?? null,
        processedFiles: data.processed_files ?? null,
        totalChunks: data.total_chunks ?? null,
        processedChunks: data.processed_chunks ?? null,
        totalRows: data.total_rows ?? null,
      }));

      startDatasetPolling(taskId);
    } catch (err) {
      console.error("Failed to start dataset generation", err);
      setDatasetPopup((prev) => ({
        ...prev,
        status: "failed",
        error: "Failed to start dataset generation. Please try again.",
      }));
      f7.dialog.alert(
        "Failed to start JSONL dataset generation. Please try again.",
        "Error",
      );
      stopDatasetPolling();
    }
  };

  const handleRunFineTune = (taskId: string) => {
    const srcTask = tasks.find((t) => t.id === taskId);
    if (!srcTask) {
      f7.dialog.alert("Task not found.", "Error");
      return;
    }

    if (srcTask.datasetStatus !== "succeeded") {
      f7.toast
        .create({
          text: "Please generate the JSONL dataset first.",
          closeTimeout: 2000,
        })
        .open();
      return;
    }

    if (!srcTask.datasetPath) {
      f7.dialog.alert(
        "Dataset path is missing. Please regenerate the dataset.",
        "Error",
      );
      return;
    }

    setFtPopup({
      isOpen: true,
      sourceTaskId: taskId,
      ftTaskId: null,
      status: "idle",
      error: "",
      baseModel: "google/gemma-3-270m-it",
      hubModelId: "",
      numTrainEpochs: 1,
      learningRate: 1e-5,
      perDeviceTrainBatchSize: 4,
      maxLength: 2048,
      hfToken: "",
      lastMessage: "",
      progressPercent: null,
      currentEpoch: null,
      totalEpochs: null,
    });
  };

    const handleStartGguf = async () => {
    if (!resultPopup.taskId) {
      f7.dialog.alert("Task is not set for GGUF generation.", "Error");
      return;
    }

    const token =
      localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);

    if (!token) {
      f7.toast
        .create({
          text: "Missing auth token, please sign in again",
          closeTimeout: 2000,
        })
        .open();
      return;
    }

    const task = tasks.find((t) => t.id === resultPopup.taskId);
    if (!task || task.ftStatus !== "succeeded") {
      f7.toast
        .create({
          text: "Fine-tuning must succeed before GGUF generation.",
          closeTimeout: 2500,
        })
        .open();
      return;
    }

    const quantization = resultPopup.quantizationMethod.trim() || "q4_k_m";

    try {
      const { data } = await axios.post(
        `${BASE_API_URL}/tasks/${resultPopup.taskId}/gguf`,
        { quantization_method: quantization },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const mappedStatus = mapStageStatus(data.gguf_status);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === resultPopup.taskId
            ? {
                ...t,
                ggufStatus: mappedStatus,
                ggufQuantization: data.gguf_quantization ?? quantization,
                ggufPath: data.gguf_path ?? null,
              }
            : t,
        ),
      );

      setResultPopup((prev) => ({
        ...prev,
        ggufStatus: mappedStatus,
        ggufQuantization: data.gguf_quantization ?? quantization,
        ggufPath: data.gguf_path ?? "",
        ggufError: data.error ?? "",
      }));

      if (mappedStatus === "pending" || mappedStatus === "running") {
        startGgufPolling(resultPopup.taskId);
      }

      f7.toast
        .create({
          text: "GGUF generation started",
          closeTimeout: 2000,
        })
        .open();
    } catch (err) {
      console.error("Failed to start GGUF generation", err);
      setResultPopup((prev) => ({
        ...prev,
        ggufStatus: "failed",
        ggufError: "Failed to start GGUF generation. Please try again.",
      }));
      f7.dialog.alert(
        "Failed to start GGUF generation. Please try again.",
        "Error",
      );
    }
  };

  const handleStartOllama = async () => {
    if (!resultPopup.taskId) {
      f7.dialog.alert("Task is not set for Ollama model creation.", "Error");
      return;
    }

    const token =
      localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);

    if (!token) {
      f7.toast
        .create({
          text: "Missing auth token, please sign in again",
          closeTimeout: 2000,
        })
        .open();
      return;
    }

    const task = tasks.find((t) => t.id === resultPopup.taskId);
    if (!task || task.ggufStatus !== "succeeded") {
      f7.toast
        .create({
          text: "GGUF must be ready before creating an Ollama model.",
          closeTimeout: 2500,
        })
        .open();
      return;
    }

    const defaultModelName =
      task.ollamaModelName ||
      (task.name || "")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-]/g, "") ||
      `ft-model-${resultPopup.taskId}`;

    const modelName =
      resultPopup.ollamaModelNameInput.trim() || defaultModelName;

    try {
      const { data } = await axios.post(
        `${BASE_API_URL}/tasks/${resultPopup.taskId}/ollama`,
        {
          model_name: modelName,
          system_prompt: resultPopup.ollamaSystemPrompt || "",
          temperature: resultPopup.ollamaTemperature || 0.7,
          push_to_registry: resultPopup.ollamaPushToRegistry,
          registry_model_name: resultPopup.ollamaRegistryModelName || "",
          ollama_api_key: resultPopup.ollamaApiKey || "",
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const mappedStatus = mapStageStatus(data.ollama_status);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === resultPopup.taskId
            ? {
                ...t,
                ollamaStatus: mappedStatus,
                ollamaModelName: data.ollama_model_name ?? modelName,
              }
            : t,
        ),
      );

      setResultPopup((prev) => ({
        ...prev,
        ollamaStatus: mappedStatus,
        ollamaModelName: data.ollama_model_name ?? modelName,
        ollamaError: data.error ?? "",
      }));

      if (mappedStatus === "pending" || mappedStatus === "running") {
        startOllamaPolling(resultPopup.taskId);
      }

      f7.toast
        .create({
          text: "Ollama model creation started",
          closeTimeout: 2000,
        })
        .open();
    } catch (err) {
      console.error("Failed to create Ollama model", err);
      setResultPopup((prev) => ({
        ...prev,
        ollamaStatus: "failed",
        ollamaError: "Failed to create Ollama model. Please try again.",
      }));
      f7.dialog.alert(
        "Failed to create Ollama model. Please try again.",
        "Error",
      );
    }
  };


  const handleStartFineTune = async () => {
      const token =
        localStorage.getItem(ID_TOKEN_KEY) ?? getSharedCookie(ID_TOKEN_KEY);

      if (!token) {
        f7.toast
          .create({
            text: "Missing auth token, please sign in again",
            closeTimeout: 2000,
          })
          .open();
        return;
      }

      if (!ftPopup.sourceTaskId) {
        f7.dialog.alert("Source dataset task is not set.", "Error");
        return;
      }

      const srcTask = tasks.find((t) => t.id === ftPopup.sourceTaskId);
      if (!srcTask || srcTask.datasetStatus !== "succeeded" || !srcTask.datasetPath) {
        f7.dialog.alert(
          "Dataset is not ready. Please regenerate the JSONL dataset.",
          "Error",
        );
        return;
      }

      if (!ftPopup.baseModel.trim() || !ftPopup.hubModelId.trim()) {
        f7.toast
          .create({
            text: "Please fill in base model and hub model id.",
            closeTimeout: 2000,
          })
          .open();
        return;
      }

      if (!ftPopup.hfToken.trim()) {
        f7.toast
          .create({
            text: "Please provide your Hugging Face token.",
            closeTimeout: 2000,
          })
          .open();
        return;
      }

      try {
        const body = {
          draft_task_id: ftPopup.sourceTaskId,

          base_model: ftPopup.baseModel.trim(),
          hub_model_id: ftPopup.hubModelId.trim(),
          num_train_epochs: Number(ftPopup.numTrainEpochs),
          learning_rate: Number(ftPopup.learningRate),
          per_device_train_batch_size: Number(ftPopup.perDeviceTrainBatchSize),
          max_length: Number(ftPopup.maxLength),
          notes: `FT from dataset task ${ftPopup.sourceTaskId}`,

          eval_jsonl_url: null,
          hf_token: ftPopup.hfToken.trim(),
        };

        const { data } = await axios.post(`${BASE_API_URL}/tasks`, body, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const newTaskId: string = data.task_id; // this will now be == ftPopup.sourceTaskId

        setFtPopup((prev) => ({
          ...prev,
          ftTaskId: newTaskId,
          status: "running",
          error: "",
        }));

        await fetchTasksFromBackend();
        startFtPolling(newTaskId);

        f7.toast
          .create({
            text: "Fine-tuning started",
            closeTimeout: 2000,
          })
          .open();
      } catch (err) {
        console.error("Failed to start fine-tuning", err);
        setFtPopup((prev) => ({
          ...prev,
          status: "failed",
          error: "Failed to start fine-tuning. Please check the parameters.",
        }));
        f7.dialog.alert(
          "Failed to start fine-tuning. Please check the parameters and try again.",
          "Error",
        );
        stopFtPolling();
      }
    };


    const handleViewResult = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      f7.dialog.alert("Task not found.", "Error");
      return;
    }

    const defaultModelName =
      task.ollamaModelName ||
      (task.name || "")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-]/g, "") ||
      `ft-model-${taskId}`;

    setResultPopup((prev) => ({
      ...prev,
      isOpen: true,
      taskId,
      hfRepoId: task.hfRepoId ?? "",
      ggufStatus: task.ggufStatus ?? "idle",
      ggufQuantization: task.ggufQuantization ?? "",
      ggufPath: task.ggufPath ?? "",
      ggufError: "",
      ollamaStatus: task.ollamaStatus ?? "idle",
      ollamaModelName: task.ollamaModelName ?? "",
      ollamaError: "",
      quantizationMethod:
        task.ggufQuantization && task.ggufQuantization.length > 0
          ? task.ggufQuantization
          : prev.quantizationMethod,
      ollamaModelNameInput: defaultModelName,
    }));

    if (task.ggufStatus === "pending" || task.ggufStatus === "running") {
      startGgufPolling(taskId);
    }
    if (task.ollamaStatus === "pending" || task.ollamaStatus === "running") {
      startOllamaPolling(taskId);
    }
  };


  /* -------------------- Derived progress for popup -------------------- */
  const chunkProgressPercent =
    datasetPopup.totalChunks &&
    datasetPopup.processedChunks != null &&
    datasetPopup.totalChunks > 0
      ? Math.round(
          (datasetPopup.processedChunks / datasetPopup.totalChunks) * 100,
        )
      : null;

  const fileProgressPercent =
    datasetPopup.totalFiles &&
    datasetPopup.processedFiles != null &&
    datasetPopup.totalFiles > 0
      ? Math.round(
          (datasetPopup.processedFiles / datasetPopup.totalFiles) * 100,
        )
      : null;

  /* --------------------------- Render -------------------------------- */
  return (
    <App name="FT.app" theme="ios">
      {!isAuthenticated ? (
        <LoginScreen opened>
          <View>
            <Page loginScreen>
              <LoginScreenTitle>Sign in with Google</LoginScreenTitle>
              <Block>
                <div
                  id="google-signin-button"
                  align="center"
                  style={{
                    width: "100%",
                    maxWidth: 250,
                    margin: "1rem auto 0",
                    height: 50,
                    pointerEvents: isTermsAccepted ? "auto" : "none",
                    opacity: isTermsAccepted ? 1 : 0.5,
                    justifyContent: "center",
                  }}
                />

                <div style={{ display: "flex", justifyContent: "center" }}>
                  <List
                    outlineIos
                    dividersIos
                    style={{ width: "100%", maxWidth: 250, paddingLeft: 0 }}
                  >
                    <ListItem
                      className="important-weight allow-wrap"
                      checkbox
                      name="terms-checkbox"
                      style={{ fontSize: "x-small" }}
                      title={
                        <>
                          I agree to the{" "}
                          <Link
                            external
                            href="https://github.com/chigwell/dash.fine-tune.app/blob/main/TERMS.md"
                            target="_blank"
                          >
                            Terms of Service
                          </Link>{" "}
                          and acknowledge the{" "}
                          <Link
                            external
                            href="https://github.com/chigwell/dash.fine-tune.app/blob/main/PRIVACY.md"
                            target="_blank"
                          >
                            Privacy Policy
                          </Link>
                          .
                        </>
                      }
                      checked={isTermsAccepted}
                      onChange={(e) =>
                        setIsTermsAccepted((e.target).checked)
                      }
                    />
                  </List>
                </div>
              </Block>

              {isLoading && (
                <Block style={{ textAlign: "center" }}>
                  <Preloader />
                </Block>
              )}
            </Page>
          </View>
        </LoginScreen>
      ) : (
        <View main>
          <Page pageContent pageContentProps={{ id: "panel-page" }}>
            <Panel left effect="push" id="panel-nested" containerEl="#panel-page">
              <View>
                <Page>
                  <Block strongIos outlineIos>
                    <p>This is page-nested Panel.</p>
                    <p>
                      <Link panelClose>Close me</Link>
                    </p>
                  </Block>
                </Page>
              </View>
            </Panel>

            <Navbar>
              <NavTitle>FT.app Dashboard</NavTitle>
              <NavRight
                style={{
                  marginRight: "12px",
                  color:
                    "var(--f7-button-text-color,var(--f7-theme-color))",
                  cursor: "pointer",
                }}
              >
                <Link onClick={handleLogout}>Logout</Link>
              </NavRight>
            </Navbar>

            {/* Welcome --------------------------------------------------- */}
            <Block>
              <p>Welcome, {userEmail}!</p>
            </Block>

            {/* Data table ------------------------------------------------ */}
            <BlockTitle medium>FT Tasks</BlockTitle>
            <Card className="data-table data-table-init">
              <CardHeader>
                <div className="data-table-links">
                  <Button small onClick={openAddPopup} outline>
                    Start New FT Task
                  </Button>
                </div>
                <div className="data-table-actions"></div>
              </CardHeader>

              <CardContent padding={false} style={{ minHeight: 50 }}>
                {isTasksLoading ? (
                  <div style={{ textAlign: "center", padding: "1rem" }}>
                    <Preloader />
                  </div>
                ) : tasks.length === 0 ? (
                  <Block inset>There are no tasks yet.</Block>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th
                          className="label-cell"
                          style={{ textAlign: "left" }}
                        >
                          Name
                        </th>
                        <th
                          className="label-cell"
                          style={{ textAlign: "left" }}
                        >
                          Created
                        </th>
                        <th className="label-cell">Inputs</th>
                        <th className="label-cell">JSONL Dataset</th>
                        <th className="label-cell">FT</th>
                        <th className="label-cell">Benchmarks</th>
                        <th className="label-cell">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((task) => (
                        <tr key={task.id}>
                          <td className="label-cell">{task.name}</td>
                          <td className="label-cell">
                            {new Date(task.createdAt).toLocaleString()}
                          </td>
                          <td className="label-cell">
                            {task.files.length ? (
                              <>
                                <Icon
                                  ios="f7:checkmark_alt_circle"
                                  color="green"
                                />{" "}
                                {task.files.length} file(s)
                                <span
                                  style={{
                                    marginLeft: 6,
                                    fontSize: "11px",
                                    color: "#888",
                                  }}
                                >
                                  {renderFilePreview(task.files)}
                                </span>
                              </>
                            ) : (
                              <>
                                <Icon
                                  ios="f7:checkmark_alt_circle"
                                  color="gray"
                                />{" "}
                                No files yet
                              </>
                            )}
                          </td>

                          <td className="label-cell">
                            {task.datasetStatus === "idle" ? (
                              <>
                                <Icon
                                  ios="f7:pause_circle_fill"
                                  color="orange"
                                />{" "}
                                Draft{" "}
                                <Link
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleGenerateDataset(task.id);
                                  }}
                                >
                                  Generate
                                </Link>
                              </>
                            ) : task.datasetStatus === "pending" ||
                              task.datasetStatus === "running" ? (
                              <>
                                <Preloader
                                  style={{
                                    display: "inline-block",
                                    verticalAlign: "middle",
                                    marginRight: 4,
                                  }}
                                />
                                Generating...{" "}
                                <Link
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleGenerateDataset(task.id);
                                  }}
                                >
                                  View
                                </Link>
                              </>
                            ) : task.datasetStatus === "succeeded" ? (
                              <>
                                <Icon
                                  ios="f7:checkmark_alt_circle"
                                  color="green"
                                />{" "}
                                Ready{" "}
                                <Link
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleGenerateDataset(task.id);
                                  }}
                                >
                                  View
                                </Link>
                              </>
                            ) : (
                              <>
                                <Icon
                                  ios="f7:xmark_circle_fill"
                                  color="red"
                                />{" "}
                                Failed{" "}
                                <Link
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleGenerateDataset(task.id);
                                  }}
                                >
                                  Retry
                                </Link>
                              </>
                            )}
                          </td>

                                                    <td className="label-cell">
                            {task.ftStatus === "succeeded" ? (
                              <>
                                <Icon
                                  ios="f7:checkmark_alt_circle"
                                  color="green"
                                />{" "}
                                Done
                              </>
                            ) : task.ftStatus === "failed" ? (
                              <>
                                <Icon
                                  ios="f7:xmark_circle_fill"
                                  color="red"
                                />{" "}
                                Failed
                              </>
                            ) : task.ftStatus === "running" ||
                              task.ftStatus === "pending" ? (
                              <>
                                <Preloader
                                  style={{
                                    display: "inline-block",
                                    verticalAlign: "middle",
                                    marginRight: 4,
                                  }}
                                />
                                Fine-tuning...
                              </>
                            ) : (
                              <>
                                <Icon
                                  ios="f7:pause_circle_fill"
                                  color="orange"
                                />{" "}
                                Not started{" "}
                                {task.datasetStatus === "succeeded" && (
                                  <Link
                                    href="#"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      handleRunFineTune(task.id);
                                    }}
                                  >
                                    Run
                                  </Link>
                                )}
                              </>
                            )}
                          </td>

                          <td
                            className="label-cell"
                            style={{ color: "#898989" }}
                          >
                            <Icon
                              ios="f7:pencil_circle"
                              style={{ color: "#898989" }}
                            />{" "}
                            Coming soon
                          </td>

                                                    <td className="label-cell">
                            {task.ollamaStatus === "succeeded" ? (
                              <>
                                <Icon
                                  ios="f7:checkmark_alt_circle"
                                  color="green"
                                />{" "}
                                <Link
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleViewResult(task.id);
                                  }}
                                >
                                  Ready
                                </Link>
                              </>
                            ) : task.ollamaStatus === "failed" ? (
                              <>
                                <Icon
                                  ios="f7:xmark_circle_fill"
                                  color="red"
                                />{" "}
                                <Link
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleViewResult(task.id);
                                  }}
                                >
                                  Failed
                                </Link>
                              </>
                            ) : task.ollamaStatus === "running" ||
                              task.ollamaStatus === "pending" ||
                              task.ggufStatus === "running" ||
                              task.ggufStatus === "pending" ? (
                              <>
                                <Preloader
                                  style={{
                                    display: "inline-block",
                                    verticalAlign: "middle",
                                    marginRight: 4,
                                  }}
                                />
                                <Link
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleViewResult(task.id);
                                  }}
                                >
                                  In progress
                                </Link>
                              </>
                            ) : task.ggufStatus === "succeeded" ? (
                              <>
                                <Icon
                                  ios="f7:checkmark_alt_circle"
                                  color="green"
                                />{" "}
                                <Link
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleViewResult(task.id);
                                  }}
                                >
                                  GGUF ready
                                </Link>
                              </>
                            ) : (
                              <>
                                <Icon
                                  ios="f7:pencil_circle"
                                  style={{ color: "#898989" }}
                                />{" "}
                                <Link
                                  href="#"
                                  style={{ color: "#898989" }}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleViewResult(task.id);
                                  }}
                                >
                                  Configure
                                </Link>
                              </>
                            )}
                          </td>

                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {/* New FT task popup ----------------------------------------- */}
            <Popup
              push
              opened={isAddPopupOpen}
              onPopupClosed={() => setIsAddPopupOpen(false)}
            >
              <Page>
                <Navbar title="New fine-tuning task" />
                <List strongIos dividersIos insetIos>
                  <ListInput
                    label="Task name"
                    type="text"
                    placeholder="E.g. Support bot v1"
                    value={newTaskName}
                    onInput={(e) =>
                      setNewTaskName(
                        (e.target).value,
                      )
                    }
                    clearButton
                  />

                  <ListItem
                    title="Training files"
                    className="important-weight allow-wrap"
                  >
                    <div style={{ width: "100%" }}>
                      <FileUploader
                        multiple
                        handleChange={handleNewTaskFilesChange}
                        name="training-files"
                        types={FILE_TYPES}
                        maxSize={50}
                        onTypeError={(err) => {
                          f7.toast
                            .create({
                              text: String(err),
                              closeTimeout: 2000,
                            })
                            .open();
                        }}
                      >
                        <div
                          style={{
                            width: "100%",
                            border: "1px dashed #ccc",
                            borderRadius: 8,
                            padding: "12px",
                            textAlign: "center",
                            fontSize: "13px",
                          }}
                        >
                          Drop .docx / .txt / .pdf here or click to
                          select
                        </div>
                      </FileUploader>

                      {newTaskFiles.length > 0 && (
                        <ul
                          style={{
                            fontSize: "11px",
                            marginTop: 8,
                            paddingLeft: 0,
                            listStyle: "none",
                          }}
                        >
                          {newTaskFiles.map((f, index) => (
                            <li
                              key={`${f.name}-${f.size}-${index}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <span
                                style={{
                                  marginRight: 8,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {f.name} ({formatFileSizeMb(f)} MB)
                              </span>
                              <Link
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleRemoveNewTaskFile(index);
                                }}
                                style={{
                                  fontSize: "11px",
                                  color: "#e53935",
                                }}
                              >
                                Remove
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </ListItem>
                </List>

                <Toolbar bottom>
                  <Button
                    fill
                    large
                    style={{ marginLeft: "auto" }}
                    onClick={handleCreateTask}
                  >
                    Create
                  </Button>
                </Toolbar>
              </Page>
            </Popup>

            {/* Dataset progress popup ------------------------------------ */}
            <Popup
              push
              opened={datasetPopup.isOpen}
              onPopupClosed={() => {
                stopDatasetPolling();
                setDatasetPopup((prev) => ({
                  ...prev,
                  isOpen: false,
                }));
              }}
            >
              <Page>
                <Navbar title="JSONL dataset generation" />
                <Block>
                  <p>
                    Task ID:{" "}
                    <span style={{ fontFamily: "monospace" }}>
                      {datasetPopup.taskId}
                    </span>
                  </p>
                  <p>
                    Status:{" "}
                    <strong style={{ textTransform: "capitalize" }}>
                      {datasetPopup.status}
                    </strong>
                  </p>

                  {(datasetPopup.status === "pending" ||
                    datasetPopup.status === "running") && (
                    <p>
                      <Preloader
                        style={{
                          display: "inline-block",
                          verticalAlign: "middle",
                          marginRight: 6,
                        }}
                      />
                      Generating JSONL from your files...
                    </p>
                  )}

                  {datasetPopup.totalFiles != null && (
                    <p>
                      Files: {datasetPopup.processedFiles ?? 0}/
                      {datasetPopup.totalFiles}
                      {fileProgressPercent != null &&
                        ` (${fileProgressPercent}%)`}
                    </p>
                  )}

                  {datasetPopup.totalChunks != null && (
                    <p>
                      Chunks: {datasetPopup.processedChunks ?? 0}/
                      {datasetPopup.totalChunks}
                      {chunkProgressPercent != null &&
                        ` (${chunkProgressPercent}%)`}
                    </p>
                  )}

                  {datasetPopup.totalRows != null && (
                    <p>JSONL rows written: {datasetPopup.totalRows}</p>
                  )}

                  {datasetPopup.error && (
                    <p style={{ color: "#e53935" }}>
                      Error: {datasetPopup.error}
                    </p>
                  )}

                  {datasetPopup.status === "succeeded" &&
                    datasetPopup.totalRows != null && (
                      <p>
                        Dataset is ready. You can now use this JSONL
                        file as input for fine-tuning.
                      </p>
                    )}
                </Block>

                <Toolbar bottom>
                  <Button
                    fill
                    large
                    onClick={() => {
                      stopDatasetPolling();
                      setDatasetPopup((prev) => ({
                        ...prev,
                        isOpen: false,
                      }));
                    }}
                    style={{ marginLeft: "auto" }}
                  >
                    Close
                  </Button>
                </Toolbar>
              </Page>
            </Popup>

                        {/* Fine-tuning popup ---------------------------------------- */}
            <Popup
              push
              opened={ftPopup.isOpen}
              onPopupClosed={() => {
                stopFtPolling();
                setFtPopup((prev) => ({
                  ...prev,
                  isOpen: false,
                }));
              }}
            >
              <Page>
                <Navbar title="Fine-tuning" />
                <Block>
                  <p>
                    Source task ID:{" "}
                    <span style={{ fontFamily: "monospace" }}>
                      {ftPopup.sourceTaskId}
                    </span>
                  </p>
                  {ftPopup.ftTaskId && (
                    <p>
                      FT task ID:{" "}
                      <span style={{ fontFamily: "monospace" }}>
                        {ftPopup.ftTaskId}
                      </span>
                    </p>
                  )}

                  <List strongIos dividersIos insetIos>
                    <ListInput
                      label="Base model"
                      type="text"
                      placeholder="e.g. google/gemma-2-9b-it"
                      value={ftPopup.baseModel}
                      onInput={(e) =>
                        setFtPopup((prev) => ({
                          ...prev,
                          baseModel: (e.target).value,
                        }))
                      }
                      clearButton
                    />
                    <ListInput
                      label="HF hub model id"
                      type="text"
                      placeholder="username/my-ft-model"
                      value={ftPopup.hubModelId}
                      onInput={(e) =>
                        setFtPopup((prev) => ({
                          ...prev,
                          hubModelId: (e.target).value,
                        }))
                      }
                      clearButton
                    />
                    <ListInput
                      label="HF token"
                      type="password"
                      placeholder="hf_xxx"
                      value={ftPopup.hfToken}
                      onInput={(e) =>
                        setFtPopup((prev) => ({
                          ...prev,
                          hfToken: (e.target).value,
                        }))
                      }
                      clearButton
                    />
                    <ListInput
                      label="Epochs"
                      type="number"
                      value={ftPopup.numTrainEpochs}
                      onInput={(e) =>
                        setFtPopup((prev) => ({
                          ...prev,
                          numTrainEpochs: Number(
                            (e.target).value || 1,
                          ),
                        }))
                      }
                    />
                    <ListInput
                      label="Learning rate"
                      type="number"
                      step="0.000001"
                      value={ftPopup.learningRate}
                      onInput={(e) =>
                        setFtPopup((prev) => ({
                          ...prev,
                          learningRate: Number(
                            (e.target).value || 1e-5,
                          ),
                        }))
                      }
                    />
                    <ListInput
                      label="Batch size"
                      type="number"
                      value={ftPopup.perDeviceTrainBatchSize}
                      onInput={(e) =>
                        setFtPopup((prev) => ({
                          ...prev,
                          perDeviceTrainBatchSize: Number(
                            (e.target).value || 4,
                          ),
                        }))
                      }
                    />
                    <ListInput
                      label="Max length"
                      type="number"
                      value={ftPopup.maxLength}
                      onInput={(e) =>
                        setFtPopup((prev) => ({
                          ...prev,
                          maxLength: Number(
                            (e.target).value || 2048,
                          ),
                        }))
                      }
                    />
                  </List>

                  {ftPopup.status !== "idle" && (
                    <>
                      <p>
                        Status:{" "}
                        <strong style={{ textTransform: "capitalize" }}>
                          {ftPopup.status}
                        </strong>
                      </p>
                      {ftPopup.progressPercent != null && (
                        <p>
                          Progress: {Math.round(ftPopup.progressPercent)}%
                        </p>
                      )}
                      {ftPopup.currentEpoch != null &&
                        ftPopup.totalEpochs != null && (
                          <p>
                            Epoch: {ftPopup.currentEpoch}/
                            {ftPopup.totalEpochs}
                          </p>
                        )}
                      {ftPopup.lastMessage && <p>{ftPopup.lastMessage}</p>}
                      {ftPopup.error && (
                        <p style={{ color: "#e53935" }}>{ftPopup.error}</p>
                      )}
                    </>
                  )}
                </Block>

                <Toolbar bottom>
                  {ftPopup.ftTaskId == null && (
                    <Button fill large onClick={handleStartFineTune}>
                      Start
                    </Button>
                  )}
                  <Button
                    fill
                    large
                    onClick={() => {
                      stopFtPolling();
                      setFtPopup((prev) => ({
                        ...prev,
                        isOpen: false,
                      }));
                    }}
                    style={{ marginLeft: "auto" }}
                  >
                    Close
                  </Button>
                </Toolbar>
              </Page>
            </Popup>

                        {/* Result / GGUF / Ollama popup ------------------------------ */}
            <Popup
              push
              opened={resultPopup.isOpen}
              onPopupClosed={() => {
                stopGgufPolling();
                stopOllamaPolling();
                setResultPopup((prev) => ({
                  ...prev,
                  isOpen: false,
                }));
              }}
            >
              <Page>
                <Navbar title="Result & deployment" />
                <Block strongIos outlineIos>
                  <p>
                    Task ID:{" "}
                    <span style={{ fontFamily: "monospace" }}>
                      {resultPopup.taskId}
                    </span>
                  </p>
                  {resultPopup.hfRepoId && (
                    <p>
                      HF repo:{" "}
                      <span style={{ fontFamily: "monospace" }}>
                        {resultPopup.hfRepoId}
                      </span>
                    </p>
                  )}
                </Block>

                <BlockTitle medium>1. GGUF quantisation</BlockTitle>
                <Block>
                  <p>
                    Status:{" "}
                    <strong style={{ textTransform: "capitalize" }}>
                      {resultPopup.ggufStatus}
                    </strong>
                  </p>
                  {(resultPopup.ggufStatus === "running" ||
                    resultPopup.ggufStatus === "pending") && (
                    <p>
                      <Preloader
                        style={{
                          display: "inline-block",
                          verticalAlign: "middle",
                          marginRight: 6,
                        }}
                      />
                      Converting to GGUF...
                    </p>
                  )}

                  <List strongIos dividersIos insetIos>
                    <ListInput
                      label="Quantization method"
                      type="text"
                      placeholder="e.g. q4_k_m"
                      value={resultPopup.quantizationMethod}
                      onInput={(e) =>
                        setResultPopup((prev) => ({
                          ...prev,
                          quantizationMethod: (e.target)
                            .value,
                        }))
                      }
                      clearButton
                    />
                  </List>

                  {resultPopup.ggufPath && (
                    <p>
                      GGUF path:{" "}
                      <span style={{ fontFamily: "monospace" }}>
                        {resultPopup.ggufPath}
                      </span>
                    </p>
                  )}

                  {resultPopup.ggufError && (
                    <p style={{ color: "#e53935" }}>
                      {resultPopup.ggufError}
                    </p>
                  )}

                  <Button
                    fill
                    large
                    disabled={
                      !resultPopup.taskId ||
                      resultPopup.ggufStatus === "running" ||
                      resultPopup.ggufStatus === "pending"
                    }
                    onClick={handleStartGguf}
                  >
                    {resultPopup.ggufStatus === "idle" ||
                    resultPopup.ggufStatus === "failed"
                      ? "Generate GGUF"
                      : "Regenerate GGUF"}
                  </Button>
                </Block>

                <BlockTitle medium>2. Ollama model</BlockTitle>
                <Block>
                  <p>
                    Status:{" "}
                    <strong style={{ textTransform: "capitalize" }}>
                      {resultPopup.ollamaStatus}
                    </strong>
                  </p>
                  {(resultPopup.ollamaStatus === "running" ||
                    resultPopup.ollamaStatus === "pending") && (
                    <p>
                      <Preloader
                        style={{
                          display: "inline-block",
                          verticalAlign: "middle",
                          marginRight: 6,
                        }}
                      />
                      Creating Ollama model...
                    </p>
                  )}

                  <List strongIos dividersIos insetIos>
                    <ListInput
                      label="Ollama model name"
                      type="text"
                      placeholder="e.g. llm7/ft-support-bot"
                      value={resultPopup.ollamaModelNameInput}
                      onInput={(e) =>
                        setResultPopup((prev) => ({
                          ...prev,
                          ollamaModelNameInput: (
                            e.target
                          ).value,
                        }))
                      }
                      clearButton
                    />
                    <ListInput
                      label="System prompt (optional)"
                      type="textarea"
                      placeholder="System prompt for the model"
                      value={resultPopup.ollamaSystemPrompt}
                      onInput={(e) =>
                        setResultPopup((prev) => ({
                          ...prev,
                          ollamaSystemPrompt: (
                            e.target
                          ).value,
                        }))
                      }
                    />
                    <ListItem
                      title={`Temperature: ${resultPopup.ollamaTemperature.toFixed(
                        2,
                      )}`}
                      className="important-weight allow-wrap"
                    >
                      <div style={{ width: "100%" }}>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={resultPopup.ollamaTemperature}
                          onChange={(e) =>
                            setResultPopup((prev) => ({
                              ...prev,
                              ollamaTemperature: Number(e.target.value),
                            }))
                          }
                          style={{ width: "100%" }}
                        />
                      </div>
                    </ListItem>
                  </List>

                  {resultPopup.ollamaModelName && (
                    <p>
                      Model:{" "}
                      <span style={{ fontFamily: "monospace" }}>
                        {resultPopup.ollamaModelName}
                      </span>
                    </p>
                  )}

                  {resultPopup.ollamaError && (
                    <p style={{ color: "#e53935" }}>
                      {resultPopup.ollamaError}
                    </p>
                  )}

                  <Button
                    fill
                    large
                    disabled={
                      !resultPopup.taskId ||
                      resultPopup.ggufStatus !== "succeeded" ||
                      resultPopup.ollamaStatus === "running" ||
                      resultPopup.ollamaStatus === "pending"
                    }
                    onClick={handleStartOllama}
                  >
                    {resultPopup.ollamaStatus === "idle" ||
                    resultPopup.ollamaStatus === "failed"
                      ? "Create Ollama model"
                      : "Recreate Ollama model"}
                  </Button>

                  {resultPopup.ollamaStatus === "succeeded" &&
                    resultPopup.ollamaModelName && (
                      <Block strongIos outlineIos>
                        <p>Example usage in Ollama CLI:</p>
                        <pre
                          style={{
                            fontSize: "11px",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                          }}
                        >
                            {`ollama run ${resultPopup.ollamaModelName}`}
                        </pre>
                      </Block>
                    )}
                </Block>

                <Toolbar bottom>
                  <Button
                    fill
                    large
                    onClick={() => {
                      stopGgufPolling();
                      stopOllamaPolling();
                      setResultPopup((prev) => ({
                        ...prev,
                        isOpen: false,
                      }));
                    }}
                    style={{ marginLeft: "auto" }}
                  >
                    Close
                  </Button>
                </Toolbar>
              </Page>
            </Popup>



            {/* Token created popup --------------------------------------- */}
            <Popup
              push
              opened={isCreatedTokenPopupOpen}
              onPopupClosed={() => {
                setIsCreatedTokenPopupOpen(false);
                setCreatedTokenString("");
              }}
            >
              <Page>
                <Navbar title="Token Created" />
                <Block>
                  <p style={{ wordBreak: "break-all" }}>
                    {createdTokenString}
                  </p>
                  <Button
                    fill
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        createdTokenString,
                      );
                      f7.toast
                        .create({
                          text: "Copied to clipboard",
                          closeTimeout: 2000,
                        })
                        .open();
                    }}
                  >
                    Copy
                  </Button>
                </Block>
                <Toolbar bottom>
                  <Button
                    fill
                    large
                    onClick={() => setIsCreatedTokenPopupOpen(false)}
                    style={{ marginLeft: "auto" }}
                  >
                    Done
                  </Button>
                </Toolbar>
              </Page>
            </Popup>
          </Page>
        </View>
      )}
    </App>
  );
}

export default MyApp;
