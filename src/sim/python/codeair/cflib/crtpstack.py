# This file is part of CodeAIR, and includes portions of code derived from the
# Crazyflie Python client library.
#
# Copyright (c) 2011-2013 Bitcraze AB
# Modifications Copyright (c) 2024 Firia, Inc.
#
#  Crazyflie Nano Quadcopter Client
#
#  This program is free software; you can redistribute it and/or
#  modify it under the terms of the GNU General Public License
#  as published by the Free Software Foundation; either version 2
#  of the License, or (at your option) any later version.
#
#  This program is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU General Public License for more details.
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.
"""
`crtp` packet and ports.
"""

import crtp

SET_SETPOINT_CHANNEL = 0

class CRTPPort:
    """
    Lists the available ports for the CRTP.
    """
    CONSOLE = 0x00
    PARAM = 0x02
    COMMANDER = 0x03
    MEM = 0x04
    LOGGING = 0x05
    LOCALIZATION = 0x06
    COMMANDER_GENERIC = 0x07
    SETPOINT_HL = 0x08
    PLATFORM = 0x0D
    LINKCTRL = 0x0F
    ALL = 0xFF


class CRTPPacket():
    """Firia Labs: Emulate necessary interfaces of CRTPpacket and crazyflie object.
    """
    def __init__(self):
        self.channel = SET_SETPOINT_CHANNEL

    def send_packet(self, pk):
        crtp.send(pk.port, pk.channel, pk.data)

