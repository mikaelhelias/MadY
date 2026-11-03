# R Graph Gallery: line chart, several groups (dplyr pipeline + pipe into ggplot)
library(ggplot2)
library(babynames)
library(dplyr)
library(hrbrthemes)
library(viridis)

don <- babynames %>%
  filter(name %in% c("Ashley", "Patricia", "Helen")) %>%
  filter(sex=="F")

don %>%
  ggplot( aes(x=year, y=n, group=name, color=name)) +
    geom_line() +
    scale_color_viridis(discrete = TRUE) +
    ggtitle("Popularity of American names in the previous 30 years") +
    theme_ipsum() +
    ylab("Number of babies born")
