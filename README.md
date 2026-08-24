# EEG Annotator

A research-oriented desktop application for **EEG visualization, exploratory data analysis (EDA), clinical annotation, and EEG export**.

Workflow

                    EEG Annotator
                         │
                         ▼
                    Open EDF
                         │
                         ▼
                  File Information
                         │
                         ▼
              EEG Visualization
              ┌──────────┴──────────┐
              ▼                     ▼
         Raw EEG              Bipolar EEG
              │                     │
              └──────────┬──────────┘
                         ▼
                        EDA
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
             PSD     Band Power   Signal Features
                         │
                         ▼
                    Annotation
                         │
                         ▼
                       Export
              ┌──────────┼──────────┐
              ▼          ▼          ▼
          JSON        EDF+       HTML Report


# Features

1. File Handling

The application provides a simple workflow for loading clinical EEG recordings.

### Open EDF - An EDF recording can be loaded using the **Open EDF** button available from:

### File Information Panel - After loading a recording, the left sidebar displays:

* Patient information
* Recording information
* Recording date/time
* Recording duration
* Channel count
* Sampling rate
* EDF/EDF+ status

### Channel List - All available channels are automatically listed.

Each channel is displayed with a color-coded badge and its sampling rate.

2. EEG Visualization

The visualization system provides an interactive multi-channel EEG canvas

## Time Navigation

The user can navigate through long EEG recordings using:

3. Exploratory Data Analysis (EDA)

The EDA module can be opened by clicking **EDA** in the toolbar.

EDA is intended to provide a quantitative overview of the EEG signal before machine-learning analysis.

Frequency bands are visually highlighted:

* Delta
* Theta
* Alpha
* Beta
* Gamma


4. Annotation

The annotation system allows users to mark clinically relevant events directly on the EEG waveform.

5. Export

The toolbar contains an **Export** dropdown.

## Annotation JSON

