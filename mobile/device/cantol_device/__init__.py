"""Cantol measurement software for the Red Pitaya (STEMlab 125-14 4-Input).

Channel 1 is the mains reference (a 50 or 60 Hz sine), channels 2 to 4 are three partial discharge
sensors. The program finds pulses on the sensors, gives each one its phase of the mains cycle and
streams them to the Cantol mobile app over the app's protocol (ADR-010, ADR-011).

Run it with:  python3 -m cantol_device run --source redpitaya
Try it without hardware:  python3 -m cantol_device run --source simulated
"""

VERSION = "0.1.0"
