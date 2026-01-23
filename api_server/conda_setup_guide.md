# Anaconda Environment Setup Guide

This guide walks through creating, activating, validating, installing dependencies, exporting, backing up, and removing conda environments.

## 1. Create a conda environment

### Basic creation
```bash
conda create -n openai-proxy python=3.10
```

### Create from an environment file
```bash
conda env create -f environment.yml
```

### Create with specific channels
```bash
conda create -n openai-proxy -c conda-forge python=3.10
```

## 2. Activate and verify the environment

### Activate
```bash
conda activate openai-proxy
```

### Verify Python and conda environment
```bash
python --version
which python  # Windows: where python
conda info --envs
```

### Check installed packages
```bash
conda list
```

## 3. Install dependencies (multiple ways)

### Option A: conda install
```bash
conda install -c conda-forge flask flask-cors openai requests
```

### Option B: pip install (inside the environment)
```bash
pip install -r requirements.txt
```

### Option C: mix conda and pip
Use conda for core packages and pip for the rest:
```bash
conda install -c conda-forge flask flask-cors
pip install openai requests
```

### Option D: update from environment.yml
```bash
conda env update -f environment.yml --prune
```

## 4. Export and back up the environment

### Export full environment (includes platform-specific packages)
```bash
conda env export -n openai-proxy > environment.lock.yml
```

### Export a minimal, portable environment
```bash
conda env export -n openai-proxy --from-history > environment.yml
```

### Export just pip packages (if needed)
```bash
pip freeze > requirements.lock.txt
```

## 5. Remove and clean the environment

### Remove environment
```bash
conda env remove -n openai-proxy
```

### Clean caches (optional)
```bash
conda clean --all
```

## 6. Common troubleshooting

### Problem: conda command not found
- Ensure Anaconda/Miniconda is installed.
- Reopen the terminal or run:
  ```bash
  conda init
  ```

### Problem: environment not activating
- Run `conda info --envs` and verify the environment exists.
- Restart the terminal after `conda init`.
- On Windows PowerShell, run:
  ```powershell
  conda init powershell
  ```

### Problem: package conflicts / solving takes too long
- Prefer conda-forge consistently:
  ```bash
  conda config --add channels conda-forge
  conda config --set channel_priority strict
  ```
- Try mamba if available:
  ```bash
  conda install -n base -c conda-forge mamba
  mamba create -n openai-proxy python=3.10
  ```

### Problem: pip installs to base instead of env
- Ensure the environment is activated.
- Run `which pip` (or `where pip` on Windows) to confirm.

### Problem: SSL errors when installing packages
- Make sure system date/time is correct.
- Try switching to conda-forge:
  ```bash
  conda install -n openai-proxy -c conda-forge openssl ca-certificates certifi
  ```

### Problem: environment uses wrong Python version
- Recreate the environment explicitly:
  ```bash
  conda create -n openai-proxy python=3.10
  ```

## Notes
- Prefer `environment.yml` for shared, reproducible setups.
- Use `environment.lock.yml` for exact, frozen environments.
